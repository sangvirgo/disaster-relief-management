-- C48 Identity service — synthetic demo users and grants.
-- Target: an EMPTY database migrated to the current Identity schema.
-- Load: psql -v ON_ERROR_STOP=1 -v seed_password_hash='<argon2id hash made by the app>' -f seed-identity.sql
-- The application bootstrap script supplies the password hash; this file contains no credentials.
-- When the psql variable is absent, the unusable placeholder prevents demo accounts from logging in.

\if :{?seed_password_hash}
\else
  \set seed_password_hash 'CHANGE_ME_HASH_FROM_APP'
\endif

BEGIN;

CREATE FUNCTION pg_temp.u(h text) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('00000000-0000-4000-8000-' || lpad(h, 12, '0'))::uuid $$;

INSERT INTO app_user (id, username, display_name, email, email_verified_at, password_hash, status, must_change_password)
SELECT pg_temp.u(v.suffix), v.username, v.display_name,
       v.username || '+' || substr(md5(pg_temp.u(v.suffix)::text), 1, 10) || '@example.test',
       now(), :'seed_password_hash', 'ACTIVE', true
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
  ('111', 'coord_extra',    'Điều phối viên bổ sung (demo)')
) AS v(suffix, username, display_name)
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (user_id, role_code, scope_type, campaign_id)
SELECT pg_temp.u(g.suffix), g.role_code, g.scope_type, g.campaign_id
FROM (VALUES
  ('101', 'ADMIN',              'SYSTEM',   NULL::uuid),
  ('102', 'COORDINATOR',        'SYSTEM',   NULL::uuid),
  ('102', 'COORDINATOR',        'CAMPAIGN', pg_temp.u('c3')),
  ('103', 'COORDINATOR',        'SYSTEM',   NULL::uuid),
  ('103', 'COORDINATOR',        'CAMPAIGN', pg_temp.u('c3')),
  ('104', 'CAMPAIGN_MANAGER',   'CAMPAIGN', pg_temp.u('c3')),
  ('105', 'OPERATIONS_MANAGER', 'SYSTEM',   NULL::uuid),
  ('106', 'INTAKE_STAFF',       'SYSTEM',   NULL::uuid),
  ('107', 'INTAKE_STAFF',       'SYSTEM',   NULL::uuid),
  ('108', 'REVIEWER',           'SYSTEM',   NULL::uuid),
  ('109', 'REVIEWER',           'SYSTEM',   NULL::uuid),
  ('10a', 'DISTRIBUTION_STAFF', 'SYSTEM',   NULL::uuid),
  ('10b', 'DISTRIBUTION_STAFF', 'SYSTEM',   NULL::uuid),
  ('10c', 'VOLUNTEER',          'SYSTEM',   NULL::uuid),
  ('10d', 'VOLUNTEER',          'SYSTEM',   NULL::uuid),
  ('10e', 'VOLUNTEER',          'SYSTEM',   NULL::uuid),
  ('10f', 'CITIZEN',            'SYSTEM',   NULL::uuid),
  ('110', 'CITIZEN',            'SYSTEM',   NULL::uuid),
  ('111', 'COORDINATOR',        'SYSTEM',   NULL::uuid),
  ('111', 'COORDINATOR',        'CAMPAIGN', pg_temp.u('c3'))
) AS g(suffix, role_code, scope_type, campaign_id)
JOIN app_user u ON u.id = pg_temp.u(g.suffix)
WHERE NOT EXISTS (
  SELECT 1 FROM role_grant r
   WHERE r.user_id = u.id AND r.role_code = g.role_code AND r.scope_type = g.scope_type
     AND r.campaign_id IS NOT DISTINCT FROM g.campaign_id AND r.revoked_at IS NULL
);

-- The bootstrap seed is the only permitted self-grant.
INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, reason)
VALUES (NULL, 'SEED_LOADED', 'SYSTEM', 'seed-identity', 'Dữ liệu demo tổng hợp, không phải người thật');

COMMIT;
