-- C48 Identity service — physical schema (PostgreSQL 16+; PostGIS NOT required here).
-- Conventions: uuid PKs (app generates UUIDv7; DEFAULT gen_random_uuid() is a fallback),
-- timestamptz in UTC, text + CHECK instead of native enums, version column on mutable aggregates.
CREATE EXTENSION IF NOT EXISTS citext;

-- Rule for every human-readable label: not blank and NFC-normalised (blocks NFC/NFD look-alike duplicates)
CREATE FUNCTION is_clean_text(t text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT btrim(t) <> '' AND t = normalize(t, NFC) $$;

CREATE TABLE region (
  code        text PRIMARY KEY CHECK (code ~ '^[A-Z0-9_]{2,32}$'),
  name        text NOT NULL CHECK (is_clean_text(name)),
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE organization (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL CHECK (is_clean_text(name)),
  organization_kind text NOT NULL CHECK (organization_kind IN ('COORDINATION','VOLUNTEER','MILITARY','GOVERNMENT','OTHER')),
  status            text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  version           int NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX organization_name_uq ON organization (lower(name));

CREATE TABLE app_user (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username             citext NOT NULL UNIQUE CHECK (username::text ~ '^[A-Za-z0-9._-]{3,64}$'),
  display_name         text NOT NULL CHECK (is_clean_text(display_name)),
  password_hash        text NOT NULL,
  status               text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  must_change_password boolean NOT NULL DEFAULT false,
  authz_version        int NOT NULL DEFAULT 1,   -- bumped on disable / reset / any grant change: revoke-all barrier + introspection cache key
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              int NOT NULL DEFAULT 1
) WITH (fillfactor = 85);
CREATE INDEX app_user_created_idx ON app_user (created_at DESC, id DESC);                          -- GET /users keyset
CREATE INDEX app_user_username_prefix_idx ON app_user (lower(username::text) text_pattern_ops, id); -- ?query= is a case-insensitive PREFIX match
CREATE INDEX app_user_display_prefix_idx ON app_user (lower(display_name) text_pattern_ops, id);

CREATE TABLE membership (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES app_user(id),
  organization_id uuid NOT NULL REFERENCES organization(id),
  status          text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);
CREATE INDEX membership_org_idx ON membership (organization_id);

-- Roles are a code-level catalog (fixed seeds); role -> permission mapping lives in code (see 05-permissions.md).
CREATE TABLE role_grant (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES app_user(id),
  role_code       text NOT NULL CHECK (role_code IN ('CITIZEN','VOLUNTEER','COORDINATOR','CAMPAIGN_MANAGER','OPERATIONS_MANAGER','INTAKE_STAFF','REVIEWER','DISTRIBUTION_STAFF','ADMIN')),
  scope_type      text NOT NULL CHECK (scope_type IN ('SYSTEM','ORGANIZATION','REGION','CAMPAIGN')),
  organization_id uuid REFERENCES organization(id),
  region_code     text REFERENCES region(code),
  campaign_id     uuid,                       -- opaque Response reference, validated through the Response API
  granted_by      uuid NOT NULL REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  revoked_by      uuid REFERENCES app_user(id),
  CONSTRAINT scope_shape CHECK (
    (scope_type = 'SYSTEM'       AND organization_id IS NULL AND region_code IS NULL AND campaign_id IS NULL) OR
    (scope_type = 'ORGANIZATION' AND organization_id IS NOT NULL AND region_code IS NULL AND campaign_id IS NULL) OR
    (scope_type = 'REGION'       AND organization_id IS NOT NULL AND region_code IS NOT NULL AND campaign_id IS NULL) OR
    (scope_type = 'CAMPAIGN'     AND organization_id IS NOT NULL AND campaign_id IS NOT NULL AND region_code IS NULL)),
  CONSTRAINT revoke_pair CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CONSTRAINT revoke_after_create CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CONSTRAINT role_scope CHECK (
    (role_code = 'ADMIN' AND scope_type = 'SYSTEM') OR
    (role_code IN ('CITIZEN','VOLUNTEER') AND scope_type IN ('SYSTEM','ORGANIZATION')) OR
    (role_code NOT IN ('ADMIN','CITIZEN','VOLUNTEER') AND scope_type <> 'SYSTEM'))
);   -- self-grant (granted_by = user_id) is refused by the service, except the one-time bootstrap seed
-- one live grant per (user, role, exact scope); NULLs compared as equal via COALESCE
CREATE UNIQUE INDEX role_grant_live_uq ON role_grant (
  user_id, role_code, scope_type,
  COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(region_code, ''),
  COALESCE(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid)
) WHERE revoked_at IS NULL;
-- introspection hot path is served by role_grant_live_uq (leading column user_id); no separate index
CREATE INDEX role_grant_org_idx ON role_grant (organization_id) WHERE organization_id IS NOT NULL;

-- one row per login; the whole rotation chain shares it. Revoking a family is a single-row update.
CREATE TABLE session_family (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- JWT `sid`
  user_id             uuid NOT NULL REFERENCES app_user(id),
  client_kind         text NOT NULL CHECK (client_kind IN ('WEB','NATIVE')),
  authz_version       int NOT NULL,                                 -- user's authz_version when issued; a lower value is rejected
  created_at          timestamptz NOT NULL DEFAULT now(),
  absolute_expires_at timestamptz NOT NULL,
  revoked_at          timestamptz,
  revoke_reason       text CHECK (revoke_reason IN ('LOGOUT','REUSE_DETECTED','ADMIN','PASSWORD_RESET','ROLE_CHANGE','DISABLED')),
  CONSTRAINT revoke_reason_pair CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)),
  CONSTRAINT expiry_after_create CHECK (absolute_expires_at > created_at)
);
CREATE INDEX session_family_user_live_idx ON session_family (user_id) WHERE revoked_at IS NULL;
CREATE INDEX session_family_expiry_idx ON session_family (absolute_expires_at);                 -- cleanup

CREATE TABLE refresh_session (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id   uuid NOT NULL REFERENCES session_family(id),
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  rotated_at  timestamptz                                        -- set (first) when exchanged for the next token
);
-- at most one live (un-rotated) token per family: the rotation race cannot create two
CREATE UNIQUE INDEX refresh_session_one_live_uq ON refresh_session (family_id) WHERE rotated_at IS NULL;
CREATE INDEX refresh_session_rotated_idx ON refresh_session (rotated_at) WHERE rotated_at IS NOT NULL;   -- purge after the reuse-grace window

CREATE TABLE audit_log (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id  uuid,
  action         text NOT NULL,
  entity_type    text NOT NULL,
  entity_id      text NOT NULL,
  before_state   jsonb,
  after_state    jsonb,
  reason         text,
  correlation_id uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC, id DESC);
CREATE INDEX audit_log_type_idx   ON audit_log (entity_type, created_at DESC, id DESC);
CREATE INDEX audit_log_actor_idx  ON audit_log (actor_user_id, created_at DESC, id DESC);

CREATE TABLE idempotency_record (
  scope_key       text NOT NULL,               -- actor id or 'anon:<purpose>' (service-local)
  command         text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash    text NOT NULL,
  response_status int,
  response_body   jsonb,                      -- <= 4 KiB: status + resource id, never PII
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, command, idempotency_key)
) WITH (fillfactor = 70, autovacuum_vacuum_scale_factor = 0.02);
CREATE INDEX idempotency_record_created_idx ON idempotency_record (created_at);        -- retention cleanup

-- append-only audit (the migration must also REVOKE UPDATE, DELETE, TRUNCATE from the application role)
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME; END $$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
