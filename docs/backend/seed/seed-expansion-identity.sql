-- Additive synthetic Identity fixtures. Safe to apply more than once.
WITH demo_accounts(suffix, username) AS (VALUES
  ('101', 'admin'), ('102', 'coord1'), ('103', 'coord2'), ('104', 'campaign_mgr'),
  ('105', 'ops_mgr'), ('106', 'intake1'), ('107', 'intake2'), ('108', 'reviewer1'),
  ('109', 'reviewer2'), ('10a', 'dist1'), ('10b', 'dist2'), ('10c', 'vol_leader1'),
  ('10d', 'vol_leader2'), ('10e', 'vol_member1'), ('10f', 'citizen1'), ('110', 'citizen2'),
  ('111', 'coord_regional'), ('112', 'ops_seed'), ('113', 'citizen3'), ('114', 'vol_leader3'),
  ('115', 'vol_member3'), ('116', 'vol_leader4'), ('117', 'vol_member4'), ('118', 'coord_seed')
)
UPDATE app_user AS account
   SET email = demo.username || '+' || substr(md5(account.id::text), 1, 10) || '@example.test',
       email_verified_at = COALESCE(account.email_verified_at, now()),
       status = 'ACTIVE',
       must_change_password = true
  FROM demo_accounts AS demo
 WHERE account.id = ('00000000-0000-4000-8000-' || lpad(demo.suffix, 12, '0'))::uuid
   AND account.username::text = demo.username;

INSERT INTO app_user (id, username, display_name, email, email_verified_at, password_hash, status, must_change_password) VALUES
  ('00000000-0000-4000-8000-000000000112', 'ops_seed', 'Quản lý vận hành 2 (demo)', 'ops_seed+' || substr(md5('00000000-0000-4000-8000-000000000112'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000113', 'citizen3', 'Người dân 3 (demo)', 'citizen3+' || substr(md5('00000000-0000-4000-8000-000000000113'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000114', 'vol_leader3', 'Đội trưởng tình nguyện 3 (demo)', 'vol_leader3+' || substr(md5('00000000-0000-4000-8000-000000000114'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000115', 'vol_member3', 'Tình nguyện viên 3 (demo)', 'vol_member3+' || substr(md5('00000000-0000-4000-8000-000000000115'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000116', 'vol_leader4', 'Đội trưởng tình nguyện 4 (demo)', 'vol_leader4+' || substr(md5('00000000-0000-4000-8000-000000000116'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000117', 'vol_member4', 'Tình nguyện viên 4 (demo)', 'vol_member4+' || substr(md5('00000000-0000-4000-8000-000000000117'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000118', 'coord_seed', 'Điều phối viên bổ sung (demo)', 'coord_seed+' || substr(md5('00000000-0000-4000-8000-000000000118'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true)
ON CONFLICT DO NOTHING;

INSERT INTO membership (user_id, organization_id)
SELECT u.id, o.id
  FROM (VALUES
    ('00000000-0000-4000-8000-000000000112'::uuid, 'ops_seed', '00000000-0000-4000-8000-000000000001'::uuid, 'Trung tâm điều phối C48 (demo)'),
    ('00000000-0000-4000-8000-000000000114'::uuid, 'vol_leader3', '00000000-0000-4000-8000-000000000002'::uuid, 'Hội tình nguyện miền Nam (demo)'),
    ('00000000-0000-4000-8000-000000000115'::uuid, 'vol_member3', '00000000-0000-4000-8000-000000000002'::uuid, 'Hội tình nguyện miền Nam (demo)'),
    ('00000000-0000-4000-8000-000000000116'::uuid, 'vol_leader4', '00000000-0000-4000-8000-000000000002'::uuid, 'Hội tình nguyện miền Nam (demo)'),
    ('00000000-0000-4000-8000-000000000117'::uuid, 'vol_member4', '00000000-0000-4000-8000-000000000002'::uuid, 'Hội tình nguyện miền Nam (demo)'),
    ('00000000-0000-4000-8000-000000000118'::uuid, 'coord_seed', '00000000-0000-4000-8000-000000000001'::uuid, 'Trung tâm điều phối C48 (demo)')
  ) AS fixture(user_id, username, organization_id, organization_name)
  JOIN app_user u ON u.id = fixture.user_id AND u.username::text = fixture.username
  JOIN organization o ON o.id = fixture.organization_id AND o.name = fixture.organization_name
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (user_id, role_code, scope_type, organization_id, region_code)
SELECT u.id, fixture.role_code, fixture.scope_type, fixture.organization_id, NULL
  FROM (VALUES
    ('00000000-0000-4000-8000-000000000112'::uuid, 'ops_seed', 'OPERATIONS_MANAGER', 'ORGANIZATION', '00000000-0000-4000-8000-000000000001'::uuid, 'Trung tâm điều phối C48 (demo)'),
    ('00000000-0000-4000-8000-000000000113'::uuid, 'citizen3', 'CITIZEN', 'SYSTEM', NULL::uuid, NULL::text),
    ('00000000-0000-4000-8000-000000000114'::uuid, 'vol_leader3', 'VOLUNTEER', 'ORGANIZATION', '00000000-0000-4000-8000-000000000002'::uuid, 'Hội tình nguyện miền Nam (demo)'),
    ('00000000-0000-4000-8000-000000000115'::uuid, 'vol_member3', 'VOLUNTEER', 'ORGANIZATION', '00000000-0000-4000-8000-000000000002'::uuid, 'Hội tình nguyện miền Nam (demo)'),
    ('00000000-0000-4000-8000-000000000116'::uuid, 'vol_leader4', 'VOLUNTEER', 'ORGANIZATION', '00000000-0000-4000-8000-000000000002'::uuid, 'Hội tình nguyện miền Nam (demo)'),
    ('00000000-0000-4000-8000-000000000117'::uuid, 'vol_member4', 'VOLUNTEER', 'ORGANIZATION', '00000000-0000-4000-8000-000000000002'::uuid, 'Hội tình nguyện miền Nam (demo)'),
    ('00000000-0000-4000-8000-000000000118'::uuid, 'coord_seed', 'COORDINATOR', 'ORGANIZATION', '00000000-0000-4000-8000-000000000001'::uuid, 'Trung tâm điều phối C48 (demo)')
  ) AS fixture(user_id, username, role_code, scope_type, organization_id, organization_name)
  JOIN app_user u ON u.id = fixture.user_id AND u.username::text = fixture.username
  LEFT JOIN organization o ON o.id = fixture.organization_id AND o.name = fixture.organization_name
 WHERE NOT EXISTS (
   SELECT 1 FROM role_grant existing
    WHERE existing.user_id = fixture.user_id AND existing.role_code = fixture.role_code AND existing.revoked_at IS NULL
 )
   AND (fixture.organization_id IS NULL OR o.id IS NOT NULL);
