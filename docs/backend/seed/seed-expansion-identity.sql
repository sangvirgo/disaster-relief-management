-- Additive synthetic Identity fixtures. Existing account state is never reset by a repeat seed.

INSERT INTO app_user (id, username, display_name, email, email_verified_at, password_hash, status, must_change_password) VALUES
  ('00000000-0000-4000-8000-000000000112', 'ops_seed', 'Quản lý vận hành 2 (demo)', 'ops_seed+' || substr(md5('00000000-0000-4000-8000-000000000112'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000113', 'citizen3', 'Người dân 3 (demo)', 'citizen3+' || substr(md5('00000000-0000-4000-8000-000000000113'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000114', 'vol_leader3', 'Đội trưởng tình nguyện 3 (demo)', 'vol_leader3+' || substr(md5('00000000-0000-4000-8000-000000000114'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000115', 'vol_member3', 'Tình nguyện viên 3 (demo)', 'vol_member3+' || substr(md5('00000000-0000-4000-8000-000000000115'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000116', 'vol_leader4', 'Đội trưởng tình nguyện 4 (demo)', 'vol_leader4+' || substr(md5('00000000-0000-4000-8000-000000000116'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000117', 'vol_member4', 'Tình nguyện viên 4 (demo)', 'vol_member4+' || substr(md5('00000000-0000-4000-8000-000000000117'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000118', 'coord_seed', 'Điều phối viên bổ sung (demo)', 'coord_seed+' || substr(md5('00000000-0000-4000-8000-000000000118'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000119', 'vol_leader_seed', 'Đội trưởng cứu hộ Bắc (demo)', 'vol_leader_seed+' || substr(md5('00000000-0000-4000-8000-000000000119'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000120', 'vol_climb_north1', 'Đội trưởng cứu hộ địa hình Bắc 1 (demo)', 'vol_climb_north1+' || substr(md5('00000000-0000-4000-8000-000000000120'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000121', 'vol_climb_north2', 'Đội trưởng cứu hộ địa hình Bắc 2 (demo)', 'vol_climb_north2+' || substr(md5('00000000-0000-4000-8000-000000000121'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000122', 'vol_climb_north3', 'Đội trưởng cứu hộ đa năng Bắc (demo)', 'vol_climb_north3+' || substr(md5('00000000-0000-4000-8000-000000000122'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000123', 'vol_free1', 'Tình nguyện viên chưa vào đội 1 (demo)', 'vol_free1+' || substr(md5('00000000-0000-4000-8000-000000000123'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000124', 'vol_free2', 'Tình nguyện viên chưa vào đội 2 (demo)', 'vol_free2+' || substr(md5('00000000-0000-4000-8000-000000000124'), 1, 10) || '@example.test', now(), :'seed_password_hash', 'ACTIVE', true)
ON CONFLICT DO NOTHING;

INSERT INTO role_grant (user_id, role_code, scope_type, campaign_id)
SELECT fixture.user_id, fixture.role_code, fixture.scope_type, fixture.campaign_id
  FROM (VALUES
    ('00000000-0000-4000-8000-000000000112'::uuid, 'ops_seed', 'OPERATIONS_MANAGER', 'SYSTEM', NULL::uuid),
    ('00000000-0000-4000-8000-000000000113'::uuid, 'citizen3', 'CITIZEN', 'SYSTEM', NULL::uuid),
    ('00000000-0000-4000-8000-000000000114'::uuid, 'vol_leader3', 'VOLUNTEER', 'SYSTEM', NULL::uuid),
    ('00000000-0000-4000-8000-000000000115'::uuid, 'vol_member3', 'VOLUNTEER', 'SYSTEM', NULL::uuid),
    ('00000000-0000-4000-8000-000000000116'::uuid, 'vol_leader4', 'VOLUNTEER', 'SYSTEM', NULL::uuid),
    ('00000000-0000-4000-8000-000000000117'::uuid, 'vol_member4', 'VOLUNTEER', 'SYSTEM', NULL::uuid),
    ('00000000-0000-4000-8000-000000000118'::uuid, 'coord_seed', 'COORDINATOR', 'SYSTEM', NULL::uuid),
    ('00000000-0000-4000-8000-000000000118'::uuid, 'coord_seed', 'COORDINATOR', 'CAMPAIGN', '00000000-0000-4000-8000-0000000000c3'::uuid),
    ('00000000-0000-4000-8000-000000000119'::uuid, 'vol_leader_seed', 'VOLUNTEER', 'SYSTEM', NULL::uuid),
    ('00000000-0000-4000-8000-000000000120'::uuid, 'vol_climb_north1', 'VOLUNTEER', 'SYSTEM', NULL::uuid),
    ('00000000-0000-4000-8000-000000000121'::uuid, 'vol_climb_north2', 'VOLUNTEER', 'SYSTEM', NULL::uuid),
    ('00000000-0000-4000-8000-000000000122'::uuid, 'vol_climb_north3', 'VOLUNTEER', 'SYSTEM', NULL::uuid),
    ('00000000-0000-4000-8000-000000000123'::uuid, 'vol_free1', 'VOLUNTEER', 'SYSTEM', NULL::uuid),
    ('00000000-0000-4000-8000-000000000124'::uuid, 'vol_free2', 'VOLUNTEER', 'SYSTEM', NULL::uuid)
  ) AS fixture(user_id, username, role_code, scope_type, campaign_id)
  JOIN app_user u ON u.id = fixture.user_id AND u.username::text = fixture.username
 WHERE NOT EXISTS (
   SELECT 1 FROM role_grant existing
    WHERE existing.user_id = fixture.user_id AND existing.role_code = fixture.role_code
      AND existing.scope_type = fixture.scope_type
      AND existing.campaign_id IS NOT DISTINCT FROM fixture.campaign_id
      AND existing.revoked_at IS NULL
 );
