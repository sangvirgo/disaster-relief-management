-- C48 Response service — physical schema (PostgreSQL 16+ with PostGIS 3).
-- Same conventions as identity.sql. No cross-service FKs: *_user_id, organization_id, campaign refs from other services are opaque uuids.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE FUNCTION is_clean_text(t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT btrim(t) <> '' AND t = normalize(t, NFC) $$;
-- one definition per status vocabulary, reused by every column that stores it
CREATE DOMAIN request_status AS text CHECK (VALUE IN ('SUBMITTED','VERIFYING','VERIFIED','REJECTED','DUPLICATE','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING','RESOLVED','CLOSED','CANCELLED'));
CREATE DOMAIN mission_status AS text CHECK (VALUE IN ('OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE','COMPLETED','FAILED','DECLINED','CANCELLED'));

-- ---------- catalogs (natural text keys; labels are Vietnamese) ----------
CREATE TABLE incident_category (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_]{2,40}$'),
  display_name text NOT NULL CHECK (is_clean_text(display_name)),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);
CREATE TABLE skill (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_]{2,40}$'),
  display_name text NOT NULL CHECK (is_clean_text(display_name))
);
-- region codes are owned by Identity; Response owns the geometry used to derive a request's region
CREATE TABLE region_boundary (
  region_code text PRIMARY KEY,
  geom        geometry(MultiPolygon, 4326) NOT NULL CHECK (ST_IsValid(geom)),   -- overlap between regions is checked by the seed test
  source_note text NOT NULL                                  -- dataset/version/licence of the seed
);
CREATE INDEX region_boundary_geom_gix ON region_boundary USING gist (geom);

CREATE TABLE campaign (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  region_code     text REFERENCES region_boundary(region_code),
  name            text NOT NULL CHECK (is_clean_text(name)),
  objective       text,
  status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','CLOSED')),
  starts_at       timestamptz,
  ends_at         timestamptz,
  created_by_user_id uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         int NOT NULL DEFAULT 1,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX campaign_scope_idx ON campaign (organization_id, status);
CREATE INDEX campaign_public_idx ON campaign (starts_at) WHERE status IN ('ACTIVE','PAUSED');   -- public summaries

-- ---------- requests ----------
CREATE TABLE assistance_request (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_code           text NOT NULL UNIQUE CHECK (tracking_code ~ '^[0-9A-HJKMNP-TV-Z]{10,16}$'),   -- public identifier (Crockford base32, >= 40 bits), NOT a credential
  tracking_secret_hash    text,                                  -- purpose-bound hash; NULL when no guest secret was supplied
  campaign_id             uuid REFERENCES campaign(id),
  incident_category_code  text NOT NULL REFERENCES incident_category(code),
  canonical_request_id    uuid REFERENCES assistance_request(id),
  report_mode             text NOT NULL CHECK (report_mode IN ('SELF','PROXY')),
  reporter_user_id        uuid,                                  -- opaque Identity id; NULL for guest SELF
  reporter_name           text CHECK (reporter_name IS NULL OR is_clean_text(reporter_name)),
  reporter_contact_phone  text NOT NULL CHECK (reporter_contact_phone ~ '^\+?[0-9]{8,15}$'),   -- service normalises first
  source_ip_hash          text,                                  -- salted hash, for abuse analysis only
  description             text CHECK (char_length(description) <= 2000),
  organization_id         uuid NOT NULL,                         -- server-assigned intake organization
  region_code             text REFERENCES region_boundary(region_code),   -- NULL => explicit unassigned queue
  status                  request_status NOT NULL DEFAULT 'SUBMITTED',
  verifying_since         timestamptz,                           -- set on entering VERIFYING; overdue is measured from here
  review_lane             text NOT NULL DEFAULT 'NORMAL' CHECK (review_lane IN ('NORMAL','RATE_LIMITED_REVIEW','PROXY_QUOTA_REVIEW')),
  priority                text CHECK (priority IN ('P1','P2','P3','P4')),
  priority_basis          text CHECK (priority_basis IN ('COMPLETE','INCOMPLETE_INFO')),
  reporter_declared_danger boolean NOT NULL DEFAULT false,
  work_cycle              int NOT NULL DEFAULT 1 CHECK (work_cycle >= 1),
  resolved_at             timestamptz,
  resolution_seal_id      uuid,                                  -- opaque Logistics seal id
  received_at             timestamptz NOT NULL DEFAULT now(),    -- server receive time
  updated_at              timestamptz NOT NULL DEFAULT now(),
  version                 int NOT NULL DEFAULT 1,
  CONSTRAINT proxy_needs_account CHECK (report_mode <> 'PROXY' OR reporter_user_id IS NOT NULL),
  CONSTRAINT duplicate_has_canonical CHECK ((status = 'DUPLICATE') = (canonical_request_id IS NOT NULL)),
  CONSTRAINT no_self_canonical CHECK (canonical_request_id IS NULL OR canonical_request_id <> id),
  CONSTRAINT resolved_pair CHECK ((resolved_at IS NULL) = (resolution_seal_id IS NULL)),
  CONSTRAINT resolved_status CHECK (status NOT IN ('RESOLVED','CLOSED') OR resolved_at IS NOT NULL),       -- reopen must clear both columns
  CONSTRAINT priority_pair CHECK ((priority IS NULL) = (priority_basis IS NULL)),
  CONSTRAINT triaged_has_priority CHECK (status NOT IN ('TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING','RESOLVED','CLOSED') OR priority IS NOT NULL),
  CONSTRAINT verifying_since_set CHECK (status <> 'VERIFYING' OR verifying_since IS NOT NULL),
  UNIQUE (id, report_mode)
) WITH (fillfactor = 85);
CREATE UNIQUE INDEX request_seal_uq ON assistance_request (resolution_seal_id) WHERE resolution_seal_id IS NOT NULL;
-- guest secret hash must be bound to at most one request
CREATE UNIQUE INDEX request_secret_uq ON assistance_request (tracking_secret_hash) WHERE tracking_secret_hash IS NOT NULL;
-- Coordinator queue = walk an ordered index and filter (measured 0.04-0.4 ms at 200k rows vs 12-16 ms for the old status-first partial index).
-- Every keyset list orders by (received_at, id): the id tiebreaker makes the cursor seekable.
CREATE INDEX request_org_fifo_idx ON assistance_request (organization_id, received_at, id);
CREATE INDEX request_org_region_fifo_idx ON assistance_request (organization_id, region_code, received_at, id);
CREATE INDEX request_unassigned_idx ON assistance_request (organization_id, received_at, id) WHERE region_code IS NULL AND status NOT IN ('REJECTED','DUPLICATE','CANCELLED','CLOSED');
CREATE INDEX request_review_lane_idx ON assistance_request (organization_id, received_at, id) WHERE review_lane <> 'NORMAL' AND status IN ('SUBMITTED','VERIFYING');
CREATE INDEX request_reporter_idx ON assistance_request (reporter_user_id, received_at DESC, id DESC) WHERE reporter_user_id IS NOT NULL;   -- "my requests" + PROXY open-cap count
CREATE INDEX request_phone_idx ON assistance_request (reporter_contact_phone, received_at DESC);                                          -- soft-throttle counting (index-only)
CREATE INDEX request_canonical_idx ON assistance_request (canonical_request_id) WHERE canonical_request_id IS NOT NULL;                    -- inbound-link guard
CREATE INDEX request_campaign_idx ON assistance_request (campaign_id, received_at, id) WHERE campaign_id IS NOT NULL;                     -- campaign-scoped grants
CREATE INDEX request_verifying_idx ON assistance_request (organization_id, verifying_since) WHERE status = 'VERIFYING';                   -- overdue badge scan (age and declared-danger)

CREATE TABLE request_subject (
  request_id               uuid PRIMARY KEY,
  report_mode              text NOT NULL,                                  -- copy of the request's mode so PROXY rules can be a CHECK
  people_affected          int NOT NULL CHECK (people_affected BETWEEN 1 AND 10000),
  location                 geography(Point, 4326) NOT NULL,
  location_source          text NOT NULL CHECK (location_source IN ('GPS','MANUAL_PIN','GEOCODED')),
  location_accuracy_m      numeric(8,1) CHECK (location_accuracy_m >= 0),   -- NULL for manual pin (never fabricated)
  location_captured_at     timestamptz,
  reporter_relationship    text,                                          -- required for PROXY (service rule)
  beneficiary_contact_phone text,
  alternate_contact_name   text,
  alternate_contact_phone  text,
  information_source       text,
  last_known_situation_at  timestamptz,
  contactability           text NOT NULL DEFAULT 'UNKNOWN' CHECK (contactability IN ('REACHABLE','UNREACHABLE','UNKNOWN')),
  household_reference_note text,
  FOREIGN KEY (request_id, report_mode) REFERENCES assistance_request(id, report_mode),
  CONSTRAINT location_source_shape CHECK (
    (location_source = 'GPS' AND location_accuracy_m IS NOT NULL AND location_captured_at IS NOT NULL) OR
    (location_source = 'MANUAL_PIN' AND location_accuracy_m IS NULL) OR
    location_source = 'GEOCODED'),
  CONSTRAINT proxy_has_relationship CHECK (report_mode <> 'PROXY' OR coalesce(btrim(reporter_relationship), '') <> '')
);
CREATE INDEX request_subject_loc_gix ON request_subject USING gist (location);

CREATE TABLE contact_attempt (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid NOT NULL REFERENCES assistance_request(id),
  actor_user_id uuid NOT NULL,
  contact_target text NOT NULL CHECK (contact_target IN ('REPORTER','BENEFICIARY','ALTERNATE','AUTHORITY')),
  outcome       text NOT NULL CHECK (outcome IN ('REACHED','NO_ANSWER','WRONG_NUMBER','OTHER')),
  note          text,
  attempted_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contact_attempt_req_idx ON contact_attempt (request_id, attempted_at);

CREATE TABLE verification_decision (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid NOT NULL REFERENCES assistance_request(id),
  outcome            text NOT NULL CHECK (outcome IN ('VERIFIED','REJECTED','DUPLICATE')),
  basis              text CHECK (basis IN ('CONTACT_CONFIRMED','CORROBORATED','EVIDENCE_REVIEWED','TWO_COORDINATOR_JUDGMENT')),
  reviewer_user_id   uuid NOT NULL,
  concurring_user_id uuid,
  reason             text CHECK (reason IS NULL OR btrim(reason) <> ''),
  reason_kind        text CHECK (reason_kind IN ('CLEARLY_INVALID','UNREACHABLE','OTHER')),
  decided_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (outcome <> 'VERIFIED' OR basis IS NOT NULL),
  CHECK (outcome = 'VERIFIED' OR (reason IS NOT NULL AND basis IS NULL AND concurring_user_id IS NULL)),
  CHECK (basis IS DISTINCT FROM 'TWO_COORDINATOR_JUDGMENT' OR (concurring_user_id IS NOT NULL AND concurring_user_id <> reviewer_user_id))
);
CREATE INDEX verification_decision_req_idx ON verification_decision (request_id, decided_at DESC);

-- business timeline. visibility separates what the reporter may read from staff-only entries
CREATE TABLE request_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid NOT NULL REFERENCES assistance_request(id),
  actor_user_id uuid,                         -- NULL = guest/system
  event_type    text NOT NULL CHECK (btrim(event_type) <> ''),
  visibility    text NOT NULL DEFAULT 'STAFF' CHECK (visibility IN ('REPORTER','STAFF')),
  from_status   request_status,
  to_status     request_status,
  reason        text,
  payload       jsonb,
  occurred_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX request_event_req_idx ON request_event (request_id, occurred_at, id);

CREATE TABLE authority_referral (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid NOT NULL REFERENCES assistance_request(id),
  actor_user_id uuid NOT NULL,
  referred_body text NOT NULL,
  note          text,
  referred_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX authority_referral_req_idx ON authority_referral (request_id);

CREATE TABLE resolution_intent (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id              uuid NOT NULL REFERENCES assistance_request(id),
  work_cycle              int NOT NULL CHECK (work_cycle >= 1),
  kind                    text NOT NULL CHECK (kind IN ('RESOLUTION','CANCELLATION')),
  state                   text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','ABORTING','COMPLETED','ABORTED')),
  actor_user_id           uuid NOT NULL,
  expected_request_version int NOT NULL,
  previous_status         request_status NOT NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX resolution_intent_one_open_uq ON resolution_intent (request_id) WHERE state IN ('PENDING','ABORTING');

-- ---------- teams & missions ----------
CREATE TABLE rescue_team (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL,
  operating_region_code    text NOT NULL REFERENCES region_boundary(region_code),
  name                     text NOT NULL CHECK (is_clean_text(name)),
  team_kind                text NOT NULL CHECK (team_kind IN ('VOLUNTEER','MILITARY','GOVERNMENT','OTHER')),
  affiliation_verified_at  timestamptz,
  affiliation_verified_by  uuid,
  availability             text NOT NULL DEFAULT 'AVAILABLE' CHECK (availability IN ('AVAILABLE','UNAVAILABLE')),
  status                   text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  int NOT NULL DEFAULT 1,
  CHECK ((affiliation_verified_at IS NULL) = (affiliation_verified_by IS NULL))
) WITH (fillfactor = 85);
CREATE INDEX rescue_team_scope_idx ON rescue_team (organization_id, operating_region_code) WHERE status = 'ACTIVE';

CREATE TABLE team_member (
  team_id     uuid NOT NULL REFERENCES rescue_team(id),
  user_id     uuid NOT NULL,
  member_role text NOT NULL CHECK (member_role IN ('LEADER','MEMBER')),
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  joined_at   timestamptz NOT NULL DEFAULT now(),
  left_at     timestamptz,                                  -- re-joining reactivates the same row; history is kept in audit_log
  PRIMARY KEY (team_id, user_id),
  CHECK ((status = 'INACTIVE') = (left_at IS NOT NULL))
);
CREATE UNIQUE INDEX team_one_leader_uq ON team_member (team_id) WHERE member_role = 'LEADER' AND status = 'ACTIVE';
CREATE UNIQUE INDEX team_member_one_team_uq ON team_member (user_id) WHERE status = 'ACTIVE';
CREATE TABLE team_skill (
  team_id    uuid NOT NULL REFERENCES rescue_team(id),
  skill_code text NOT NULL REFERENCES skill(code),
  PRIMARY KEY (team_id, skill_code)
);
CREATE TABLE team_position (
  team_id        uuid PRIMARY KEY REFERENCES rescue_team(id),
  location       geography(Point, 4326) NOT NULL,
  accuracy_m     numeric(8,1) CHECK (accuracy_m >= 0),
  captured_at    timestamptz NOT NULL,
  source         text NOT NULL CHECK (source IN ('GPS','MANUAL_PIN','COORDINATOR_REPORTED')),
  set_by_user_id uuid NOT NULL,
  note           text
);   -- no GiST: ~hundreds of teams are scanned faster than a hot-updated GiST is maintained; add one beyond ~10k positions

CREATE TABLE mission (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid NOT NULL REFERENCES assistance_request(id),
  team_id            uuid NOT NULL REFERENCES rescue_team(id),
  work_cycle         int NOT NULL CHECK (work_cycle >= 1),
  status             mission_status NOT NULL DEFAULT 'OFFERED',
  coordinator_user_id uuid NOT NULL,
  suggested_team_id  uuid,                                  -- what the candidate list suggested at offer time
  override_reason    text CHECK (override_reason IS NULL OR btrim(override_reason) <> ''),
  created_at         timestamptz NOT NULL DEFAULT now(),   -- = time offered
  accepted_at        timestamptz,
  ended_at           timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            int NOT NULL DEFAULT 1,
  CONSTRAINT ended_iff_terminal CHECK ((ended_at IS NOT NULL) = (status IN ('COMPLETED','FAILED','DECLINED','CANCELLED'))),
  CONSTRAINT ended_after_created CHECK (ended_at IS NULL OR ended_at >= created_at),
  CONSTRAINT accepted_at_matches CHECK ((status NOT IN ('ACCEPTED','EN_ROUTE','ON_SCENE','COMPLETED') OR accepted_at IS NOT NULL) AND (status <> 'DECLINED' OR accepted_at IS NULL)),
  CONSTRAINT override_needs_reason CHECK (suggested_team_id IS NULL OR suggested_team_id = team_id OR override_reason IS NOT NULL)
) WITH (fillfactor = 85);
-- DB-level capacity-one guard (capacity is not configurable in the demo, so no capacity column)
CREATE UNIQUE INDEX mission_team_one_active_uq ON mission (team_id) WHERE status IN ('OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE');
CREATE INDEX mission_request_idx ON mission (request_id, status);
CREATE INDEX mission_team_recent_idx ON mission (team_id, created_at DESC);                         -- 24 h workload count
CREATE INDEX mission_offer_overdue_idx ON mission (created_at) WHERE status = 'OFFERED';            -- overdue-offer scan

CREATE TABLE mission_event (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id     uuid NOT NULL REFERENCES mission(id),
  actor_user_id  uuid NOT NULL,
  from_status    mission_status,
  to_status      mission_status NOT NULL,
  recorded_basis text CHECK (recorded_basis IN ('RADIO','PHONE','IN_PERSON','OTHER')),  -- NOT NULL => coordinator recorded on the team's behalf
  reported_by    text,                                                                    -- who reported (required when recorded_basis is set)
  reason         text,
  note           text,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  CHECK ((recorded_basis IS NULL) = (reported_by IS NULL)),
  CHECK (recorded_basis IS NULL OR reason IS NOT NULL)
);
CREATE INDEX mission_event_idx ON mission_event (mission_id, occurred_at, id);

CREATE TABLE evidence_metadata (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid REFERENCES assistance_request(id),
  mission_id       uuid REFERENCES mission(id),
  object_key       text NOT NULL UNIQUE,
  state            text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','READY','FAILED')),
  declared_bytes   bigint NOT NULL CHECK (declared_bytes > 0),   -- quota reservation taken before upload
  size_bytes       bigint CHECK (size_bytes > 0),
  detected_mime    text CHECK (detected_mime IN ('image/jpeg','image/png','video/mp4')),
  checksum         text,
  uploader_user_id uuid,                                         -- NULL for guest
  created_at       timestamptz NOT NULL DEFAULT now(),
  ready_at         timestamptz,
  CONSTRAINT exactly_one_owner CHECK ((request_id IS NULL) <> (mission_id IS NULL)),
  CONSTRAINT ready_complete CHECK (state <> 'READY' OR (size_bytes IS NOT NULL AND detected_mime IS NOT NULL AND checksum IS NOT NULL)),
  CONSTRAINT ready_at_matches CHECK ((state = 'READY') = (ready_at IS NOT NULL)),
  CONSTRAINT size_within_declared CHECK (size_bytes IS NULL OR size_bytes <= declared_bytes)
);
CREATE INDEX evidence_request_idx ON evidence_metadata (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX evidence_mission_idx ON evidence_metadata (mission_id) WHERE mission_id IS NOT NULL;
CREATE INDEX evidence_pending_idx ON evidence_metadata (created_at) WHERE state = 'PENDING';        -- orphan reconciliation

-- ---------- cross-cutting ----------
CREATE TABLE notice (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL,
  source_type      text NOT NULL,
  source_id        uuid NOT NULL,
  source_version   int NOT NULL,
  notice_type      text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}',        -- codes + ids only; Vietnamese text is rendered from the catalog
  created_at       timestamptz NOT NULL DEFAULT now(),
  read_at          timestamptz,
  UNIQUE (source_id, source_version, recipient_user_id, notice_type)
) WITH (fillfactor = 85);
CREATE INDEX notice_unread_idx ON notice (recipient_user_id, created_at DESC, id DESC) WHERE read_at IS NULL;
CREATE INDEX notice_recipient_idx ON notice (recipient_user_id, created_at DESC, id DESC);

CREATE TABLE audit_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id  uuid, action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL,
  before_state   jsonb, after_state jsonb, reason text, correlation_id uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC, id DESC);
CREATE TABLE idempotency_record (
  scope_key text NOT NULL, command text NOT NULL, idempotency_key uuid NOT NULL, request_hash text NOT NULL,
  response_status int, response_body jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, command, idempotency_key)
) WITH (fillfactor = 70, autovacuum_vacuum_scale_factor = 0.02);
CREATE INDEX idempotency_record_created_idx ON idempotency_record (created_at);
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME; END $$;
-- append-only tables: block row changes AND TRUNCATE (also REVOKE UPDATE, DELETE, TRUNCATE from the application role in the migration)
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['audit_log','request_event','mission_event','verification_decision','contact_attempt','authority_referral'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()', t||'_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()', t||'_no_truncate', t);
  END LOOP;
END $$;
