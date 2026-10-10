-- C48 Identity service — SYNTHETIC DEMO SEED (regions, organizations, users, memberships, grants).
-- Target: an EMPTY database that already has docs/backend/schema/identity.sql applied.
-- Load:   psql -v ON_ERROR_STOP=1 -v seed_password_hash='<argon2id hash made by the app>' -f seed-identity.sql
--
-- PASSWORD RULE: this file never contains a real credential. The seeder (application bootstrap script) MUST supply
-- the password hash through the psql variable :seed_password_hash. When it is not supplied the placeholder
-- 'CHANGE_ME_HASH_FROM_APP' is stored, which can never verify, so those accounts cannot log in until reset.
-- Every account has must_change_password = true and status ACTIVE.
--
-- All data is fictional. Phones elsewhere in the demo use the 0900000xxx style; no real people are represented.
-- IDs: UUID prefix 00000000-0000-4000-8000- + the 12-hex-digit suffix shown below (shared with the Response and Logistics seeds).
--
--  suffix        username        role               scope / organization          display_name
--  ...000000000001  (ORG_COORD)     COORDINATION organization  'Trung tâm điều phối C48 (demo)'
--  ...000000000002  (ORG_VOLUNTEER) VOLUNTEER organization     'Hội tình nguyện miền Nam (demo)'
--  ...000000000101  admin           ADMIN              SYSTEM                        Quản trị hệ thống (demo)
--  ...000000000102  coord1          COORDINATOR        ORGANIZATION ORG_COORD        Điều phối viên 1 (demo)
--  ...000000000103  coord2          COORDINATOR        ORGANIZATION ORG_COORD        Điều phối viên 2 (demo)
--  ...000000000104  campaign_mgr    CAMPAIGN_MANAGER   ORGANIZATION ORG_COORD        Quản lý chiến dịch (demo)
--  ...000000000105  ops_mgr         OPERATIONS_MANAGER ORGANIZATION ORG_COORD        Quản lý vận hành (demo)
--  ...000000000106  intake1         INTAKE_STAFF       ORGANIZATION ORG_COORD        Nhân viên tiếp nhận 1 (demo)
--  ...000000000107  intake2         INTAKE_STAFF       ORGANIZATION ORG_COORD        Nhân viên tiếp nhận 2 (demo)
--  ...000000000108  reviewer1       REVIEWER           ORGANIZATION ORG_COORD        Người xác minh 1 (demo)
--  ...000000000109  reviewer2       REVIEWER           ORGANIZATION ORG_COORD        Người xác minh 2 (demo)
--  ...00000000010a  dist1           DISTRIBUTION_STAFF ORGANIZATION ORG_COORD        Nhân viên phân phát 1 (demo)
--  ...00000000010b  dist2           DISTRIBUTION_STAFF ORGANIZATION ORG_COORD        Nhân viên phân phát 2 (demo)
--  ...00000000010c  vol_leader1     VOLUNTEER          ORGANIZATION ORG_VOLUNTEER    Đội trưởng tình nguyện 1 (demo)
--  ...00000000010d  vol_leader2     VOLUNTEER          ORGANIZATION ORG_VOLUNTEER    Đội trưởng tình nguyện 2 (demo)
--  ...00000000010e  vol_member1     VOLUNTEER          ORGANIZATION ORG_VOLUNTEER    Tình nguyện viên 1 (demo)
--  ...00000000010f  citizen1        CITIZEN            SYSTEM                        Người dân 1 (demo)
--  ...000000000110  citizen2        CITIZEN            SYSTEM                        Người dân 2 (demo)
--  ...000000000111  coord_regional  COORDINATOR        REGION DEMO_A (ORG_COORD)     Điều phối viên khu vực Nam (demo)
-- Regions: DEMO_A 'Khu vực Nam (demo)', DEMO_B 'Khu vực Trung (demo)'.
-- Memberships: staff and coord_regional -> ORG_COORD; vol_* -> ORG_VOLUNTEER; admin and citizens have none.

\if :{?seed_password_hash}
\else
  \set seed_password_hash 'CHANGE_ME_HASH_FROM_APP'
\endif

BEGIN;

CREATE FUNCTION pg_temp.u(h text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('00000000-0000-4000-8000-' || lpad(h, 12, '0'))::uuid $$;

INSERT INTO region (code, name) VALUES
  ('DEMO_A', 'Khu vực Nam (demo)'),
  ('DEMO_B', 'Khu vực Trung (demo)')
ON CONFLICT DO NOTHING;

INSERT INTO organization (id, name, organization_kind) VALUES
  (pg_temp.u('1'), 'Trung tâm điều phối C48 (demo)',    'COORDINATION'),
  (pg_temp.u('2'), 'Hội tình nguyện miền Nam (demo)',   'VOLUNTEER')
ON CONFLICT DO NOTHING;

INSERT INTO app_user (id, username, display_name, password_hash, status, must_change_password)
SELECT pg_temp.u(v.suffix), v.username, v.display_name, :'seed_password_hash', 'ACTIVE', true
FROM (VALUES
  ('101', 'admin',          'Quản trị hệ thống (demo)'),
  ('102', 'coord1',         'Điều phối viên 1 (demo)'),
  ('103', 'coord2',         'Điều phối viên 2 (demo)'),
  ('104', 'campaign_mgr',   'Quản lý chiến dịch (demo)'),
  ('105', 'ops_mgr',        'Quản lý vận hành (demo)'),
  ('106', 'intake1',        'Nhân viên tiếp nhận 1 (demo)'),
  ('107', 'intake2',        'Nhân viên tiếp nhận 2 (demo)'),
  ('108', 'reviewer1',      'Người xác minh 1 (demo)'),
  ('109', 'reviewer2',      'Người xác minh 2 (demo)'),
  ('10a', 'dist1',          'Nhân viên phân phát 1 (demo)'),
  ('10b', 'dist2',          'Nhân viên phân phát 2 (demo)'),
  ('10c', 'vol_leader1',    'Đội trưởng tình nguyện 1 (demo)'),
  ('10d', 'vol_leader2',    'Đội trưởng tình nguyện 2 (demo)'),
  ('10e', 'vol_member1',    'Tình nguyện viên 1 (demo)'),
  ('10f', 'citizen1',       'Người dân 1 (demo)'),
  ('110', 'citizen2',       'Người dân 2 (demo)'),
  ('111', 'coord_regional', 'Điều phối viên khu vực Nam (demo)')
) AS v(suffix, username, display_name)
ON CONFLICT DO NOTHING;

-- organization rosters
INSERT INTO membership (user_id, organization_id)
SELECT pg_temp.u(s), pg_temp.u('1') FROM unnest(ARRAY['102','103','104','105','106','107','108','109','10a','10b','111']) AS s
ON CONFLICT DO NOTHING;
INSERT INTO membership (user_id, organization_id)
SELECT pg_temp.u(s), pg_temp.u('2') FROM unnest(ARRAY['10c','10d','10e']) AS s
ON CONFLICT DO NOTHING;

-- role grants (one live grant per user/role/scope; the unique index is partial so re-runs are guarded by the NOT EXISTS)
INSERT INTO role_grant (user_id, role_code, scope_type, organization_id, region_code)
SELECT pg_temp.u(g.suffix), g.role_code, g.scope_type,
       CASE g.scope_type WHEN 'SYSTEM' THEN NULL WHEN 'ORGANIZATION' THEN pg_temp.u(g.org) WHEN 'REGION' THEN pg_temp.u(g.org) END,
       CASE g.scope_type WHEN 'REGION' THEN 'DEMO_A' END
FROM (VALUES
  ('101', 'ADMIN',              'SYSTEM',       NULL),
  ('102', 'COORDINATOR',        'ORGANIZATION', '1'),
  ('103', 'COORDINATOR',        'ORGANIZATION', '1'),
  ('104', 'CAMPAIGN_MANAGER',   'ORGANIZATION', '1'),
  ('105', 'OPERATIONS_MANAGER', 'ORGANIZATION', '1'),
  ('106', 'INTAKE_STAFF',       'ORGANIZATION', '1'),
  ('107', 'INTAKE_STAFF',       'ORGANIZATION', '1'),
  ('108', 'REVIEWER',           'ORGANIZATION', '1'),
  ('109', 'REVIEWER',           'ORGANIZATION', '1'),
  ('10a', 'DISTRIBUTION_STAFF', 'ORGANIZATION', '1'),
  ('10b', 'DISTRIBUTION_STAFF', 'ORGANIZATION', '1'),
  ('10c', 'VOLUNTEER',          'ORGANIZATION', '2'),
  ('10d', 'VOLUNTEER',          'ORGANIZATION', '2'),
  ('10e', 'VOLUNTEER',          'ORGANIZATION', '2'),
  ('10f', 'CITIZEN',            'SYSTEM',       NULL),
  ('110', 'CITIZEN',            'SYSTEM',       NULL),
  ('111', 'COORDINATOR',        'REGION',       '1')
) AS g(suffix, role_code, scope_type, org)
WHERE NOT EXISTS (SELECT 1 FROM role_grant r WHERE r.user_id = pg_temp.u(g.suffix) AND r.role_code = g.role_code AND r.revoked_at IS NULL);

-- minimal audit: the bootstrap seed is the only permitted self-grant (see role_grant comment in identity.sql)
INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, reason)
VALUES (NULL, 'SEED_LOADED', 'SYSTEM', 'seed-identity', 'Dữ liệu demo tổng hợp, không phải người thật');

COMMIT;
