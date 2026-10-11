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
  display_name text NOT NULL CHECK (is_clean_text(display_name))
);   -- seed (data, not DDL): UNKNOWN / 'Chưa rõ' with no required skills, so a reporter is never forced to pick a wrong category
CREATE TABLE skill (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_]{2,40}$'),
  display_name text NOT NULL CHECK (is_clean_text(display_name))
);
-- required skills of a category: read by the candidate/offer all-required-skills check. The composite PK already serves lookup by category.
CREATE TABLE incident_category_skill (
  category_code text NOT NULL REFERENCES incident_category(code),
  skill_code    text NOT NULL REFERENCES skill(code),
  PRIMARY KEY (category_code, skill_code)
);
-- region codes are owned by Identity; Response owns the geometry used to derive a request's region
CREATE TABLE region_boundary (
  region_code text PRIMARY KEY,
  geom        geometry(MultiPolygon, 4326) NOT NULL CHECK (ST_IsValid(geom))   -- overlap between regions is checked by the seed test
);
COMMENT ON TABLE region_boundary IS 'Seed dataset, version and licence are recorded in the seed README, not per row.';
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
  version         int NOT NULL DEFAULT 1,
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

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
  reporter_contact_phone  text CHECK (reporter_contact_phone ~ '^\+?[0-9]{8,15}$'),   -- optional (NULL = not supplied); service normalises first
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
  resolution_seal_id      uuid,                                  -- opaque Logistics seal id (= sealing cycle_intent id); NULL allowed only while logistics_admitted_at IS NULL
  attribution_locked_at   timestamptz,                           -- set by first offer or Logistics admission; released by the coordinator release command / atomic reopen
  logistics_admitted_at   timestamptz,                           -- set only by Logistics admission; NULL => cancel skips the freeze and resolve skips the seal
  verification_revision   uuid,                                  -- approved snapshot event (same request); NULL until verified
  received_at             timestamptz NOT NULL DEFAULT now(),    -- server receive time
  version                 int NOT NULL DEFAULT 1,
  CONSTRAINT proxy_needs_account CHECK (report_mode <> 'PROXY' OR reporter_user_id IS NOT NULL),
  CONSTRAINT duplicate_has_canonical CHECK ((status = 'DUPLICATE') = (canonical_request_id IS NOT NULL)),
  CONSTRAINT no_self_canonical CHECK (canonical_request_id IS NULL OR canonical_request_id <> id),
  CONSTRAINT resolved_pair CHECK (
    (resolution_seal_id IS NULL OR resolved_at IS NOT NULL) AND                                    -- a seal implies resolved_at
    (resolved_at IS NULL OR resolution_seal_id IS NOT NULL OR logistics_admitted_at IS NULL)),     -- NULL seal only when Logistics never admitted the request
  CONSTRAINT admitted_implies_locked CHECK (logistics_admitted_at IS NULL OR attribution_locked_at IS NOT NULL),
  CONSTRAINT resolved_status CHECK (status NOT IN ('RESOLVED','CLOSED') OR resolved_at IS NOT NULL),       -- reopen must clear both columns
  CONSTRAINT priority_pair CHECK ((priority IS NULL) = (priority_basis IS NULL)),
  CONSTRAINT triaged_has_priority CHECK (status NOT IN ('TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING','RESOLVED','CLOSED') OR priority IS NOT NULL),
  CONSTRAINT verifying_since_set CHECK (status <> 'VERIFYING' OR verifying_since IS NOT NULL)
) WITH (fillfactor = 85);
CREATE UNIQUE INDEX request_seal_uq ON assistance_request (resolution_seal_id) WHERE resolution_seal_id IS NOT NULL;
-- guest secret hash must be bound to at most one request
CREATE UNIQUE INDEX request_secret_uq ON assistance_request (tracking_secret_hash) WHERE tracking_secret_hash IS NOT NULL;
-- Coordinator queue = walk an ordered index and filter (measured 0.04-0.4 ms at 200k rows vs 12-16 ms for the old status-first partial index).
-- Every keyset list orders by (received_at, id): the id tiebreaker makes the cursor seekable.
CREATE INDEX request_org_fifo_idx ON assistance_request (organization_id, received_at, id);
CREATE INDEX request_org_region_fifo_idx ON assistance_request (organization_id, region_code, received_at, id);
CREATE INDEX request_unassigned_idx ON assistance_request (organization_id, received_at, id) WHERE region_code IS NULL AND status NOT IN ('REJECTED','DUPLICATE','CANCELLED','CLOSED');
-- Attention list: SUBMITTED/VERIFYING (alert + overdue scans, all lanes) plus open reports whose reporter declared danger. Predicate must equal the query.
CREATE INDEX request_attention_idx ON assistance_request (organization_id, received_at, id)
  WHERE status IN ('SUBMITTED','VERIFYING')
     OR (reporter_declared_danger AND status IN ('VERIFIED','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING'));
CREATE INDEX request_reporter_idx ON assistance_request (reporter_user_id, received_at DESC, id DESC) WHERE reporter_user_id IS NOT NULL;   -- "my requests" + PROXY open-cap count
CREATE INDEX request_phone_idx ON assistance_request (reporter_contact_phone, received_at DESC) WHERE reporter_contact_phone IS NOT NULL;                                          -- soft-throttle counting (index-only)
CREATE INDEX request_canonical_idx ON assistance_request (canonical_request_id) WHERE canonical_request_id IS NOT NULL;                    -- inbound-link guard
CREATE INDEX request_campaign_idx ON assistance_request (campaign_id, received_at, id) WHERE campaign_id IS NOT NULL;                     -- campaign-scoped grants

CREATE TABLE request_subject (
  request_id               uuid PRIMARY KEY,
  people_affected          int CHECK (people_affected BETWEEN 1 AND 10000),
  location                 geography(Point, 4326) NOT NULL,
  location_source          text NOT NULL CHECK (location_source IN ('GPS','MANUAL_PIN')),
  location_accuracy_m      numeric(8,1) CHECK (location_accuracy_m >= 0),   -- NULL for manual pin (never fabricated)
  location_captured_at     timestamptz,
  reporter_relationship    text,                                          -- required for PROXY (trigger below)
  beneficiary_contact_phone text,
  alternate_contact_name   text,
  alternate_contact_phone  text,
  information_source       text,
  last_known_situation_at  timestamptz,
  contactability           text CHECK (contactability IN ('REACHABLE','UNREACHABLE','UNKNOWN')),
  household_reference_note text,
  FOREIGN KEY (request_id) REFERENCES assistance_request(id),
  CONSTRAINT location_source_shape CHECK (
    (location_source = 'GPS' AND location_accuracy_m IS NOT NULL AND location_captured_at IS NOT NULL) OR
    (location_source = 'MANUAL_PIN' AND location_accuracy_m IS NULL))
);
-- PROXY reports need a relationship and a declared contactability; SELF reports may leave both NULL. report_mode lives only on assistance_request.
CREATE FUNCTION request_subject_proxy_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT report_mode FROM assistance_request WHERE id = NEW.request_id) = 'PROXY' THEN
    IF coalesce(btrim(NEW.reporter_relationship), '') = '' THEN
      RAISE EXCEPTION 'PROXY request needs reporter_relationship' USING ERRCODE = 'check_violation', CONSTRAINT = 'proxy_has_relationship';
    END IF;
    IF NEW.contactability IS NULL THEN
      RAISE EXCEPTION 'PROXY request needs contactability' USING ERRCODE = 'check_violation', CONSTRAINT = 'proxy_has_contactability';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER request_subject_proxy_rules BEFORE INSERT OR UPDATE ON request_subject FOR EACH ROW EXECUTE FUNCTION request_subject_proxy_rules();
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
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, request_id)                     -- target of the same-request snapshot FKs (verification_revision on request and mission)
);
CREATE INDEX request_event_req_idx ON request_event (request_id, occurred_at, id);
-- single-writer review facts: one review per material supplement event, one failure review per failed mission
CREATE UNIQUE INDEX request_event_supplement_review_uq ON request_event ((payload->>'reviewed_event_id')) WHERE event_type = 'SUPPLEMENT_REVIEW';
CREATE UNIQUE INDEX request_event_failure_review_uq ON request_event ((payload->>'mission_id')) WHERE event_type = 'MISSION_FAILURE_REVIEW';
-- authority referral is a request_event of type AUTHORITY_REFERRED (no separate table)
ALTER TABLE assistance_request ADD CONSTRAINT request_verification_revision_fk
  FOREIGN KEY (verification_revision, id) REFERENCES request_event(id, request_id);

CREATE TABLE resolution_intent (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id              uuid NOT NULL REFERENCES assistance_request(id),
  work_cycle              int NOT NULL CHECK (work_cycle >= 1),
  kind                    text NOT NULL CHECK (kind IN ('RESOLUTION','CANCELLATION')),
  state                   text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','ABORTING','COMPLETED','ABORTED')),
  actor_user_id           uuid NOT NULL,
  expected_request_version int NOT NULL,
  previous_status         request_status NOT NULL,
  reason                  text CHECK (reason IS NULL OR btrim(reason) <> ''),
  version                 int NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()        -- the only table that keeps updated_at (state machine progress)
);
CREATE UNIQUE INDEX resolution_intent_one_open_uq ON resolution_intent (request_id) WHERE state IN ('PENDING','ABORTING');

-- ---------- teams & missions ----------
CREATE TABLE rescue_team (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL,
  operating_region_code    text NOT NULL REFERENCES region_boundary(region_code),
  name                     text NOT NULL CHECK (is_clean_text(name)),
  team_kind                text NOT NULL CHECK (team_kind IN ('VOLUNTEER','MILITARY','GOVERNMENT','OTHER')),
  reporting_mode           text NOT NULL DEFAULT 'APP' CHECK (reporting_mode IN ('APP','COORDINATOR')),
  external_contact_note    text CHECK (external_contact_note IS NULL OR btrim(external_contact_note) <> ''),   -- PII (commander phone); never in list rows
  readiness_required       boolean NOT NULL DEFAULT false,         -- latch: generic PATCH cannot bypass readiness
  affiliation_verified_at  timestamptz,
  affiliation_verified_by  uuid,
  availability             text NOT NULL DEFAULT 'AVAILABLE' CHECK (availability IN ('AVAILABLE','UNAVAILABLE')),
  status                   text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  version                  int NOT NULL DEFAULT 1,
  CHECK ((affiliation_verified_at IS NULL) = (affiliation_verified_by IS NULL)),
  CONSTRAINT coordinator_needs_contact CHECK (reporting_mode <> 'COORDINATOR' OR coalesce(btrim(external_contact_note), '') <> '')   -- coalesce: a SQL NULL must not pass
) WITH (fillfactor = 85);

CREATE TABLE team_member (
  team_id     uuid NOT NULL REFERENCES rescue_team(id),
  user_id     uuid NOT NULL,
  member_role text NOT NULL CHECK (member_role IN ('LEADER','MEMBER')),
  left_at     timestamptz,                                  -- membership = left_at IS NULL; re-joining clears it on the same row, history is kept in audit_log
  PRIMARY KEY (team_id, user_id)
);
CREATE UNIQUE INDEX team_one_leader_uq ON team_member (team_id) WHERE member_role = 'LEADER' AND left_at IS NULL;
CREATE UNIQUE INDEX team_member_one_team_uq ON team_member (user_id) WHERE left_at IS NULL;
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
  set_by_user_id uuid NOT NULL
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
  verification_revision uuid NOT NULL,                      -- approved snapshot (request_event of this request) fixed at offer time
  created_at         timestamptz NOT NULL DEFAULT now(),   -- = time offered; accept/end times live in mission_event
  version            int NOT NULL DEFAULT 1,
  FOREIGN KEY (verification_revision, request_id) REFERENCES request_event(id, request_id),
  CONSTRAINT override_needs_reason CHECK (suggested_team_id IS NULL OR suggested_team_id = team_id OR override_reason IS NOT NULL)
) WITH (fillfactor = 85);
-- DB-level capacity-one guard (capacity is not configurable in the demo, so no capacity column)
CREATE UNIQUE INDEX mission_team_one_active_uq ON mission (team_id) WHERE status IN ('OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE');
CREATE INDEX mission_request_idx ON mission (request_id, status);
CREATE INDEX mission_team_recent_idx ON mission (team_id, created_at DESC);                         -- 24 h workload count

CREATE TABLE mission_event (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id     uuid NOT NULL REFERENCES mission(id),
  actor_user_id  uuid NOT NULL,
  from_status    mission_status,
  to_status      mission_status NOT NULL,
  recorded_basis text CHECK (recorded_basis IN ('RADIO','PHONE','IN_PERSON','OTHER')),  -- NOT NULL => coordinator recorded on the team's behalf
  reported_by    text,                                                                    -- who reported (required when recorded_basis is set)
  reason         text,
  outcome_note   text CHECK (outcome_note IS NULL OR btrim(outcome_note) <> ''),         -- human outcome of a completion (media is the alternative evidence)
  occurred_at    timestamptz NOT NULL DEFAULT now(),                                      -- reported time of the fact
  recorded_at    timestamptz NOT NULL DEFAULT now(),                                      -- server time the row was written (differs when recorded on behalf)
  CHECK ((recorded_basis IS NULL) = (reported_by IS NULL)),
  CHECK (recorded_basis IS NULL OR reason IS NOT NULL)
);
CREATE INDEX mission_event_idx ON mission_event (mission_id, occurred_at, id);

CREATE TABLE evidence_metadata (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid REFERENCES assistance_request(id),
  mission_id       uuid REFERENCES mission(id),
  object_key       text NOT NULL,
  state            text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','READY','FAILED')),
  declared_bytes   bigint NOT NULL CHECK (declared_bytes > 0),   -- quota reservation taken before upload
  size_bytes       bigint CHECK (size_bytes > 0),
  detected_mime    text CHECK (detected_mime IN ('image/jpeg','image/png','video/mp4')),
  checksum         text,
  uploader_user_id uuid,                                         -- NULL for guest
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exactly_one_owner CHECK ((request_id IS NULL) <> (mission_id IS NULL)),
  CONSTRAINT ready_complete CHECK (state <> 'READY' OR (size_bytes IS NOT NULL AND detected_mime IS NOT NULL AND checksum IS NOT NULL)),
  CONSTRAINT size_within_declared CHECK (size_bytes IS NULL OR size_bytes <= declared_bytes)
);
CREATE INDEX evidence_request_idx ON evidence_metadata (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX evidence_mission_idx ON evidence_metadata (mission_id) WHERE mission_id IS NOT NULL;
CREATE INDEX evidence_pending_idx ON evidence_metadata (created_at) WHERE state = 'PENDING';        -- orphan reconciliation

-- ---------- cross-cutting ----------
CREATE TABLE notice (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL,
  source_id        uuid NOT NULL,
  source_version   int NOT NULL,
  notice_type      text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}',        -- codes + ids only; Vietnamese text is rendered from the catalog
  created_at       timestamptz NOT NULL DEFAULT now(),
  read_at          timestamptz,
  UNIQUE (source_id, source_version, recipient_user_id, notice_type)
) WITH (fillfactor = 85);
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
  response_status int, resource_type text, resource_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, command, idempotency_key),
  CHECK ((resource_type IS NULL) = (resource_id IS NULL))      -- replay re-reads the resource; no response body is stored
) WITH (fillfactor = 70, autovacuum_vacuum_scale_factor = 0.02);
CREATE INDEX idempotency_record_created_idx ON idempotency_record (created_at);
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME; END $$;
-- append-only tables: block row changes AND TRUNCATE (also REVOKE UPDATE, DELETE, TRUNCATE from the application role in the migration)
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['audit_log','request_event','mission_event','verification_decision','contact_attempt'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()', t||'_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()', t||'_no_truncate', t);
  END LOOP;
END $$;

-- one-time recovery of a request capability. id is the API issuance_id; plaintext is never stored; issuing a new code marks older unconsumed ones consumed.
CREATE TABLE capability_recovery (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id          uuid NOT NULL REFERENCES assistance_request(id),
  code_hash           text NOT NULL UNIQUE,
  expires_at          timestamptz NOT NULL,
  issued_by_user_id   uuid NOT NULL,
  basis               text NOT NULL,
  source_note         text,
  consumed_at         timestamptz,
  consumed_by_user_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consumed_pair CHECK ((consumed_at IS NULL) = (consumed_by_user_id IS NULL)),
  CONSTRAINT expires_after_created CHECK (expires_at > created_at)
);
CREATE INDEX capability_recovery_open_idx ON capability_recovery (request_id) WHERE consumed_at IS NULL;   -- supersede older unconsumed codes on issuance

-- ---------- restricted application role (T0-S exit gate) ----------
-- NOLOGIN group role; a deployment creates the login user and runs: GRANT c48_response_app TO <login_user>;
-- The migration/owner role stays a separate, privileged role. The service connects only as the login user that is a member of this role.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c48_response_app') THEN CREATE ROLE c48_response_app NOLOGIN; END IF;
END $$;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM c48_response_app;
GRANT USAGE ON SCHEMA public TO c48_response_app;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO c48_response_app;
-- mutable tables: INSERT + UPDATE (catalogs and region_boundary are seed data owned by the migration role: SELECT only)
GRANT INSERT, UPDATE ON campaign, assistance_request, request_subject, resolution_intent, rescue_team, team_member, team_skill, team_position,
  mission, evidence_metadata, notice, idempotency_record, capability_recovery TO c48_response_app;
-- append-only tables (same list as the trigger block above): INSERT only, no UPDATE, DELETE or TRUNCATE
GRANT INSERT ON audit_log, request_event, mission_event, verification_decision, contact_attempt TO c48_response_app;
-- cleanup tables: retention purge (idempotency_record, notice) and reconciler removal of FAILED/PENDING evidence rows
GRANT DELETE ON idempotency_record, notice, evidence_metadata TO c48_response_app;
GRANT DELETE ON team_skill TO c48_response_app;                     -- 'replace a team's skills as a set'
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO c48_response_app;       -- audit_log identity
