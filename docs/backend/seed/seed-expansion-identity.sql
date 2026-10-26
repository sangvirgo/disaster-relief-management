-- Additive synthetic Identity fixtures. Safe to apply more than once.
INSERT INTO app_user (id, username, display_name, password_hash, status, must_change_password) VALUES
  ('00000000-0000-4000-8000-000000000112', 'ops_seed', 'Quản lý vận hành 2 (demo)', :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000113', 'citizen3', 'Người dân 3 (demo)', :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000114', 'vol_leader3', 'Đội trưởng tình nguyện 3 (demo)', :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000115', 'vol_member3', 'Tình nguyện viên 3 (demo)', :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000116', 'vol_leader4', 'Đội trưởng tình nguyện 4 (demo)', :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000117', 'vol_member4', 'Tình nguyện viên 4 (demo)', :'seed_password_hash', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000118', 'coord_seed', 'Điều phối viên bổ sung (demo)', :'seed_password_hash', 'ACTIVE', true)
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
