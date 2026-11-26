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
       now(), :'seed_password_hash', 'ACTIVE', false
FROM (VALUES
  ('101', 'admin',          'Quản trị hệ thống'),
  ('102', 'coord1',         'Điều phối viên 1'),
  ('103', 'coord2',         'Điều phối viên 2'),
  ('105', 'ops_mgr',        'Quản lý vận hành'),
  ('108', 'reviewer1',      'Người xác minh 1'),
  ('109', 'reviewer2',      'Người xác minh 2'),
  ('10c', 'vol_leader1',    'Đội trưởng tình nguyện 1'),
  ('10d', 'vol_leader2',    'Đội trưởng tình nguyện 2'),
  ('10e', 'vol_member1',    'Tình nguyện viên 1'),
  ('10f', 'citizen1',       'Người dân 1'),
  ('110', 'citizen2',       'Người dân 2'),
  ('111', 'coord_extra',    'Điều phối viên phụ bổ sung'),
  ('125', 'coord3',         'Điều phối viên phụ 3')
) AS v(suffix, username, display_name)
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (user_id, role_code, scope_type, campaign_id)
SELECT pg_temp.u(g.suffix), g.role_code, g.scope_type, g.campaign_id
FROM (VALUES
  ('101', 'ADMIN',              'SYSTEM',   NULL::uuid),
  ('102', 'COORDINATOR',        'SYSTEM',   NULL::uuid),
  ('105', 'OPERATIONS_MANAGER', 'SYSTEM',   NULL::uuid),
  ('108', 'REVIEWER',           'SYSTEM',   NULL::uuid),
  ('109', 'REVIEWER',           'SYSTEM',   NULL::uuid),
  ('10c', 'VOLUNTEER',          'SYSTEM',   NULL::uuid),
  ('10d', 'VOLUNTEER',          'SYSTEM',   NULL::uuid),
  ('10e', 'VOLUNTEER',          'SYSTEM',   NULL::uuid),
  ('10f', 'CITIZEN',            'SYSTEM',   NULL::uuid),
  ('110', 'CITIZEN',            'SYSTEM',   NULL::uuid),
  -- Sub-coordinators: COORDINATOR at CAMPAIGN scope without a campaign; they choose (engage) campaigns themselves.
  ('103', 'COORDINATOR',        'CAMPAIGN', NULL::uuid),
  ('111', 'COORDINATOR',        'CAMPAIGN', NULL::uuid),
  ('125', 'COORDINATOR',        'CAMPAIGN', NULL::uuid)
) AS g(suffix, role_code, scope_type, campaign_id)
JOIN app_user u ON u.id = pg_temp.u(g.suffix)
WHERE NOT EXISTS (
  SELECT 1 FROM role_grant r
   WHERE r.user_id = u.id AND r.role_code = g.role_code AND r.scope_type = g.scope_type
     AND r.campaign_id IS NOT DISTINCT FROM g.campaign_id AND r.revoked_at IS NULL
);

-- The bootstrap seed is the only permitted self-grant.
INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, reason)
VALUES (NULL, 'SEED_LOADED', 'SYSTEM', 'seed-identity', 'Dữ liệu mẫu tổng hợp, không phải người thật');

-- @include demo expansion

COMMIT;
