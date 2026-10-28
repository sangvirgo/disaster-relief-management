-- Additive synthetic Response fixtures. Safe to apply more than once.
INSERT INTO incident_category (code, display_name) VALUES
  ('FLOOD', 'Ngập lụt'), ('LANDSLIDE', 'Sạt lở đất'), ('STORM', 'Bão, gió lốc'), ('MEDICAL', 'Cấp cứu y tế'),
  ('TRAPPED', 'Người bị mắc kẹt'), ('OTHER', 'Khác')
ON CONFLICT DO NOTHING;

-- Refresh only unreviewed Gemini AI samples; leave any staff-reviewed result untouched.
UPDATE ai_advisory
   SET model = 'gemini-3.1-flash-lite',
       input_hash = 'e33d48e81d0c6237e84b4c5eb0e8b0030216ef400b8d64daea2eb7fd64f8efca',
       prompt_version = 'v3',
       schema_version = 'v4',
       risk_score = NULL,
       reason_codes = ARRAY['DECLARED_LIFE_DANGER','CHILDREN_PRESENT','ELDERLY_PRESENT','RESCUE_REQUESTED'],
       extracted_json = '{"summary":"Một vụ hỏa hoạn đang xảy ra ảnh hưởng đến 6 người, trong đó có 2 trẻ em và 1 người cao tuổi, yêu cầu cứu hộ khẩn cấp.","indicators":["Cháy","Cần cứu hộ","Có trẻ em","Có người cao tuổi"],"facts":{"people_affected":6,"children_count":2,"elderly_count":1,"life_threat":true,"needs_rescue":true,"needs_relief_supplies":false},"priority_score":90,"priority_reasons":["Sự cố hỏa hoạn đe dọa trực tiếp đến tính mạng","Có sự hiện diện của trẻ em trong khu vực nguy hiểm","Có người cao tuổi cần hỗ trợ đặc biệt","Tổng số người bị ảnh hưởng là 6","Yêu cầu cứu hộ khẩn cấp đã được xác nhận"],"confidence":0.95}'::jsonb
 WHERE id = '00000000-0000-4000-8000-000000000af1'::uuid
   AND status = 'COMPLETED'
   AND review_status IS NULL;

UPDATE ai_advisory
   SET model = 'gemini-3.1-flash-lite',
       input_hash = 'bac706703a01f0759c5d16f495f7eae88526980769977cbce03dacbc690f6a46',
       prompt_version = 'v3',
       schema_version = 'v4',
       risk_score = 55,
       reason_codes = ARRAY['DECLARED_LIFE_DANGER','FLOOD_OR_TRAPPED','CHILDREN_PRESENT','ELDERLY_PRESENT','RESCUE_REQUESTED'],
       extracted_json = '{"summary":"Nhóm 3 người bao gồm 1 trẻ em và 1 người cao tuổi đang bị mắc kẹt, cần cứu hộ và cứu trợ khẩn cấp.","indicators":["Có người mắc kẹt","Cần cứu hộ","Cần hàng cứu trợ","Có trẻ em","Có người cao tuổi"],"facts":{"people_affected":3,"children_count":1,"elderly_count":1,"life_threat":false,"needs_rescue":true,"needs_relief_supplies":true},"priority_score":85,"priority_reasons":["Đối tượng dễ bị tổn thương bao gồm trẻ em và người cao tuổi","Tình trạng mắc kẹt yêu cầu cứu hộ khẩn cấp","Số lượng người bị ảnh hưởng là 3","Yêu cầu cứu trợ khẩn cấp về nhu yếu phẩm"],"confidence":0.9}'::jsonb
 WHERE id = '00000000-0000-4000-8000-000000000af2'::uuid
   AND status = 'COMPLETED'
   AND review_status IS NULL;

INSERT INTO skill (code, display_name) VALUES
  ('BOAT', 'Điều khiển xuồng, thuyền'), ('FIRST_AID', 'Sơ cấp cứu'), ('CLIMBING', 'Leo trèo, cứu hộ địa hình'),
  ('TRUCK_DRIVER', 'Lái xe tải'), ('RADIO', 'Liên lạc vô tuyến')
ON CONFLICT DO NOTHING;
INSERT INTO incident_category_skill (category_code, skill_code) VALUES
  ('FLOOD', 'BOAT'), ('TRAPPED', 'BOAT'), ('MEDICAL', 'FIRST_AID'), ('LANDSLIDE', 'CLIMBING')
ON CONFLICT DO NOTHING;

INSERT INTO rescue_team (id, organization_id, operating_region_code, name, team_kind, reporting_mode, external_contact_note,
                         readiness_required, affiliation_verified_at, affiliation_verified_by, availability) VALUES
  ('00000000-0000-4000-8000-0000000000a9', '00000000-0000-4000-8000-000000000002', 'DEMO_C',
   'Đội xuồng cứu hộ Demo C', 'VOLUNTEER', 'APP', NULL, false, now() - interval '2 days',
   '00000000-0000-4000-8000-000000000118', 'AVAILABLE'),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000002', 'DEMO_A',
   'Đội sơ cứu lưu động Demo A', 'VOLUNTEER', 'APP', NULL, false, now() - interval '2 days',
   '00000000-0000-4000-8000-000000000118', 'AVAILABLE'),
  ('00000000-0000-4000-8000-0000000000ab', '00000000-0000-4000-8000-000000000001', 'DEMO_B',
   'Đội hỗ trợ cơ động Demo B', 'GOVERNMENT', 'COORDINATOR', 'Liên lạc qua điều phối viên, đội hình giả lập Demo B.', false,
   now() - interval '2 days', '00000000-0000-4000-8000-000000000118', 'AVAILABLE'),
  ('00000000-0000-4000-8000-0000000000ac', '00000000-0000-4000-8000-000000000001', 'DEMO_C',
   'Đội y tế cộng đồng Demo C', 'GOVERNMENT', 'COORDINATOR', 'Liên lạc qua điều phối viên, đội hình giả lập Demo C.', false,
   now() - interval '1 day', '00000000-0000-4000-8000-000000000118', 'AVAILABLE'),
  ('00000000-0000-4000-8000-0000000000ad', '00000000-0000-4000-8000-000000000001', 'DEMO_A',
   'Đội xuồng cứu hộ Demo A', 'GOVERNMENT', 'COORDINATOR', 'Liên lạc qua điều phối viên, đội xuồng giả lập Demo A.', false,
   now() - interval '1 day', '00000000-0000-4000-8000-000000000118', 'AVAILABLE'),
  ('00000000-0000-4000-8000-0000000000ae', '00000000-0000-4000-8000-000000000001', 'DEMO_C',
   'Đội cứu hộ Bắc Demo', 'VOLUNTEER', 'APP', NULL, false,
   now() - interval '1 day', '00000000-0000-4000-8000-000000000118', 'AVAILABLE')
ON CONFLICT DO NOTHING;

INSERT INTO team_member (team_id, user_id, member_role)
SELECT team.id, fixture.user_id, fixture.member_role
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000000a9'::uuid, 'Đội xuồng cứu hộ Demo C', '00000000-0000-4000-8000-000000000002'::uuid, 'DEMO_C', 'VOLUNTEER', 'APP', '00000000-0000-4000-8000-000000000114'::uuid, 'LEADER'),
    ('00000000-0000-4000-8000-0000000000a9'::uuid, 'Đội xuồng cứu hộ Demo C', '00000000-0000-4000-8000-000000000002'::uuid, 'DEMO_C', 'VOLUNTEER', 'APP', '00000000-0000-4000-8000-000000000115'::uuid, 'MEMBER'),
    ('00000000-0000-4000-8000-0000000000aa'::uuid, 'Đội sơ cứu lưu động Demo A', '00000000-0000-4000-8000-000000000002'::uuid, 'DEMO_A', 'VOLUNTEER', 'APP', '00000000-0000-4000-8000-000000000116'::uuid, 'LEADER'),
    ('00000000-0000-4000-8000-0000000000aa'::uuid, 'Đội sơ cứu lưu động Demo A', '00000000-0000-4000-8000-000000000002'::uuid, 'DEMO_A', 'VOLUNTEER', 'APP', '00000000-0000-4000-8000-000000000117'::uuid, 'MEMBER'),
    ('00000000-0000-4000-8000-0000000000ae'::uuid, 'Đội cứu hộ Bắc Demo', '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_C', 'VOLUNTEER', 'APP', '00000000-0000-4000-8000-000000000119'::uuid, 'LEADER')
  ) AS fixture(team_id, team_name, organization_id, region_code, team_kind, reporting_mode, user_id, member_role)
  JOIN rescue_team team ON team.id = fixture.team_id AND team.name = fixture.team_name
                       AND team.organization_id = fixture.organization_id AND team.operating_region_code = fixture.region_code
                       AND team.team_kind = fixture.team_kind AND team.reporting_mode = fixture.reporting_mode
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO team_skill (team_id, skill_code)
SELECT team.id, fixture.skill_code
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000000a9'::uuid, 'Đội xuồng cứu hộ Demo C', '00000000-0000-4000-8000-000000000002'::uuid, 'DEMO_C', 'VOLUNTEER', 'APP', 'BOAT'),
    ('00000000-0000-4000-8000-0000000000a9'::uuid, 'Đội xuồng cứu hộ Demo C', '00000000-0000-4000-8000-000000000002'::uuid, 'DEMO_C', 'VOLUNTEER', 'APP', 'FIRST_AID'),
    ('00000000-0000-4000-8000-0000000000aa'::uuid, 'Đội sơ cứu lưu động Demo A', '00000000-0000-4000-8000-000000000002'::uuid, 'DEMO_A', 'VOLUNTEER', 'APP', 'FIRST_AID'),
    ('00000000-0000-4000-8000-0000000000aa'::uuid, 'Đội sơ cứu lưu động Demo A', '00000000-0000-4000-8000-000000000002'::uuid, 'DEMO_A', 'VOLUNTEER', 'APP', 'TRUCK_DRIVER'),
    ('00000000-0000-4000-8000-0000000000ab'::uuid, 'Đội hỗ trợ cơ động Demo B', '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_B', 'GOVERNMENT', 'COORDINATOR', 'RADIO'),
    ('00000000-0000-4000-8000-0000000000ab'::uuid, 'Đội hỗ trợ cơ động Demo B', '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_B', 'GOVERNMENT', 'COORDINATOR', 'TRUCK_DRIVER'),
    ('00000000-0000-4000-8000-0000000000ac'::uuid, 'Đội y tế cộng đồng Demo C', '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_C', 'GOVERNMENT', 'COORDINATOR', 'FIRST_AID'),
    ('00000000-0000-4000-8000-0000000000ac'::uuid, 'Đội y tế cộng đồng Demo C', '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_C', 'GOVERNMENT', 'COORDINATOR', 'CLIMBING'),
    ('00000000-0000-4000-8000-0000000000ad'::uuid, 'Đội xuồng cứu hộ Demo A', '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_A', 'GOVERNMENT', 'COORDINATOR', 'BOAT'),
    ('00000000-0000-4000-8000-0000000000ae'::uuid, 'Đội cứu hộ Bắc Demo', '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_C', 'VOLUNTEER', 'APP', 'BOAT')
  ) AS fixture(team_id, team_name, organization_id, region_code, team_kind, reporting_mode, skill_code)
  JOIN rescue_team team ON team.id = fixture.team_id AND team.name = fixture.team_name
                       AND team.organization_id = fixture.organization_id AND team.operating_region_code = fixture.region_code
                       AND team.team_kind = fixture.team_kind AND team.reporting_mode = fixture.reporting_mode
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO team_position (team_id, location, accuracy_m, captured_at, source, set_by_user_id)
SELECT team.id, ST_SetSRID(ST_MakePoint(fixture.longitude, fixture.latitude), 4326)::geography,
       NULL, now() - interval '5 minutes', 'COORDINATOR_REPORTED', '00000000-0000-4000-8000-000000000118'
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000000a9'::uuid, 'Đội xuồng cứu hộ Demo C', '00000000-0000-4000-8000-000000000002'::uuid, 'DEMO_C', 'VOLUNTEER', 'APP', 105.8500::float8, 21.0300::float8),
    ('00000000-0000-4000-8000-0000000000aa'::uuid, 'Đội sơ cứu lưu động Demo A', '00000000-0000-4000-8000-000000000002'::uuid, 'DEMO_A', 'VOLUNTEER', 'APP', 106.7000::float8, 10.7800::float8),
    ('00000000-0000-4000-8000-0000000000ab'::uuid, 'Đội hỗ trợ cơ động Demo B', '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_B', 'GOVERNMENT', 'COORDINATOR', 107.6000::float8, 16.0700::float8),
    ('00000000-0000-4000-8000-0000000000ac'::uuid, 'Đội y tế cộng đồng Demo C', '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_C', 'GOVERNMENT', 'COORDINATOR', 105.8700::float8, 21.0500::float8),
    ('00000000-0000-4000-8000-0000000000ad'::uuid, 'Đội xuồng cứu hộ Demo A', '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_A', 'GOVERNMENT', 'COORDINATOR', 106.7000::float8, 10.7800::float8),
    ('00000000-0000-4000-8000-0000000000ae'::uuid, 'Đội cứu hộ Bắc Demo', '00000000-0000-4000-8000-000000000001'::uuid, 'DEMO_C', 'VOLUNTEER', 'APP', 105.8600::float8, 21.0400::float8)
  ) AS fixture(team_id, team_name, organization_id, region_code, team_kind, reporting_mode, longitude, latitude)
  JOIN rescue_team team ON team.id = fixture.team_id AND team.name = fixture.team_name
                       AND team.organization_id = fixture.organization_id AND team.operating_region_code = fixture.region_code
                       AND team.team_kind = fixture.team_kind AND team.reporting_mode = fixture.reporting_mode
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO assistance_request (id, tracking_code, tracking_secret_hash, campaign_id, incident_category_code, report_mode,
                                reporter_user_id, reporter_name, reporter_contact_phone, description, organization_id,
                                region_code, status, verifying_since, received_at)
SELECT fixture.id, fixture.tracking_code, fixture.tracking_secret_hash, fixture.campaign_id, fixture.category_code, 'SELF',
       fixture.reporter_user_id, fixture.reporter_name, fixture.phone, fixture.description,
       '00000000-0000-4000-8000-000000000001', fixture.region_code, fixture.status::request_status, fixture.verifying_since, fixture.received_at
  FROM (VALUES
    ('00000000-0000-4000-8000-00000000f101'::uuid, 'C48SEED0001', NULL::text, '00000000-0000-4000-8000-0000000000c3'::uuid, 'FLOOD', 'DEMO_A', 'SUBMITTED', NULL::timestamptz, now() - interval '3 hours', 'Ngập vào sân nhà, cần hỗ trợ di chuyển đồ dùng.', '0900000301', '00000000-0000-4000-8000-000000000113'::uuid, 'Người dân 3 (demo)'),
    ('00000000-0000-4000-8000-00000000f102'::uuid, 'C48SEED0002', 'demo$seed-expansion$0002', '00000000-0000-4000-8000-0000000000c4'::uuid, 'STORM', 'DEMO_B', 'SUBMITTED', NULL::timestamptz, now() - interval '160 minutes', 'Mái tôn bị tốc sau gió lớn, gia đình đang ở nơi an toàn.', '0900000302', NULL::uuid, 'Người báo 02 (demo)'),
    ('00000000-0000-4000-8000-00000000f103'::uuid, 'C48SEED0003', NULL::text, '00000000-0000-4000-8000-0000000000c5'::uuid, 'LANDSLIDE', 'DEMO_C', 'SUBMITTED', NULL::timestamptz, now() - interval '145 minutes', 'Đất đá tràn ra lối đi, cần kiểm tra tuyến đường.', '0900000303', '00000000-0000-4000-8000-000000000113'::uuid, 'Người dân 3 (demo)'),
    ('00000000-0000-4000-8000-00000000f104'::uuid, 'C48SEED0004', 'demo$seed-expansion$0004', '00000000-0000-4000-8000-0000000000c6'::uuid, 'FLOOD', 'DEMO_A', 'SUBMITTED', NULL::timestamptz, now() - interval '120 minutes', 'Nước ngập tuyến đường trước nhà, cần hướng dẫn di chuyển.', '0900000304', NULL::uuid, 'Người báo 04 (demo)'),
    ('00000000-0000-4000-8000-00000000f105'::uuid, 'C48SEED0005', NULL::text, '00000000-0000-4000-8000-0000000000c7'::uuid, 'MEDICAL', 'DEMO_B', 'SUBMITTED', NULL::timestamptz, now() - interval '100 minutes', 'Người thân cần được hỗ trợ y tế tại điểm sơ tán.', '0900000305', '00000000-0000-4000-8000-000000000113'::uuid, 'Người dân 3 (demo)'),
    ('00000000-0000-4000-8000-00000000f106'::uuid, 'C48SEED0006', 'demo$seed-expansion$0006', '00000000-0000-4000-8000-0000000000c8'::uuid, 'STORM', 'DEMO_C', 'SUBMITTED', NULL::timestamptz, now() - interval '80 minutes', 'Cây đổ chắn lối vào khu dân cư, chưa ghi nhận người bị thương.', '0900000306', NULL::uuid, 'Người báo 06 (demo)'),
    ('00000000-0000-4000-8000-00000000f107'::uuid, 'C48SEED0007', NULL::text, '00000000-0000-4000-8000-0000000000c3'::uuid, 'FLOOD', 'DEMO_A', 'SUBMITTED', NULL::timestamptz, now() - interval '60 minutes', 'Một hộ cần nước uống và hỗ trợ kiểm tra an toàn.', '0900000307', '00000000-0000-4000-8000-000000000113'::uuid, 'Người dân 3 (demo)'),
    ('00000000-0000-4000-8000-00000000f108'::uuid, 'C48SEED0008', 'demo$seed-expansion$0008', '00000000-0000-4000-8000-0000000000c4'::uuid, 'OTHER', 'DEMO_B', 'SUBMITTED', NULL::timestamptz, now() - interval '50 minutes', 'Nước sinh hoạt bị gián đoạn sau mưa lớn.', '0900000308', NULL::uuid, 'Người báo 08 (demo)'),
    ('00000000-0000-4000-8000-00000000f109'::uuid, 'C48SEED0009', NULL::text, '00000000-0000-4000-8000-0000000000c5'::uuid, 'LANDSLIDE', 'DEMO_C', 'VERIFYING', now() - interval '30 minutes', now() - interval '45 minutes', 'Có vết nứt mới trên taluy gần nhà, đang chờ xác minh.', '0900000309', '00000000-0000-4000-8000-000000000113'::uuid, 'Người dân 3 (demo)'),
    ('00000000-0000-4000-8000-00000000f10a'::uuid, 'C48SEED0010', 'demo$seed-expansion$0010', '00000000-0000-4000-8000-0000000000c6'::uuid, 'FLOOD', 'DEMO_A', 'VERIFYING', now() - interval '25 minutes', now() - interval '40 minutes', 'Nước vào tầng trệt, cần xác nhận số người và tình hình hiện trường.', '0900000310', NULL::uuid, 'Người báo 10 (demo)'),
    ('00000000-0000-4000-8000-00000000f10b'::uuid, 'C48SEED0011', NULL::text, '00000000-0000-4000-8000-0000000000c7'::uuid, 'MEDICAL', 'DEMO_B', 'VERIFYING', now() - interval '20 minutes', now() - interval '35 minutes', 'Người cao tuổi cần hỗ trợ sơ cứu tại nơi trú tạm.', '0900000311', '00000000-0000-4000-8000-000000000113'::uuid, 'Người dân 3 (demo)'),
    ('00000000-0000-4000-8000-00000000f10c'::uuid, 'C48SEED0012', 'demo$seed-expansion$0012', '00000000-0000-4000-8000-0000000000c8'::uuid, 'STORM', 'DEMO_C', 'VERIFYING', now() - interval '15 minutes', now() - interval '30 minutes', 'Mái che bị hư hỏng, hộ dân đã đến điểm trú tạm.', '0900000312', NULL::uuid, 'Người báo 12 (demo)')
  ) AS fixture(id, tracking_code, tracking_secret_hash, campaign_id, category_code, region_code, status, verifying_since,
               received_at, description, phone, reporter_user_id, reporter_name)
  JOIN campaign ON campaign.id = fixture.campaign_id AND campaign.region_code = fixture.region_code
               AND campaign.organization_id = '00000000-0000-4000-8000-000000000001'
               AND campaign.name = CASE fixture.campaign_id
                 WHEN '00000000-0000-4000-8000-0000000000c3'::uuid THEN 'Hỗ trợ khẩn cấp khu vực Nam'
                 WHEN '00000000-0000-4000-8000-0000000000c4'::uuid THEN 'Tiếp tế vùng duyên hải Trung'
                 WHEN '00000000-0000-4000-8000-0000000000c5'::uuid THEN 'Cứu trợ hộ dân khu vực Bắc'
                 WHEN '00000000-0000-4000-8000-0000000000c6'::uuid THEN 'Nước sạch và nhu yếu phẩm Demo A'
                 WHEN '00000000-0000-4000-8000-0000000000c7'::uuid THEN 'Hỗ trợ sơ tán và an sinh Demo B'
                 WHEN '00000000-0000-4000-8000-0000000000c8'::uuid THEN 'Cứu trợ y tế khu vực Bắc'
               END
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO request_subject (request_id, people_affected, children_count, elderly_count, location, location_source)
SELECT fixture.id, fixture.people_affected, fixture.children_count, fixture.elderly_count,
       ST_SetSRID(ST_MakePoint(fixture.longitude, fixture.latitude), 4326)::geography, 'MANUAL_PIN'
  FROM (VALUES
    ('00000000-0000-4000-8000-00000000f101'::uuid, 'C48SEED0001', 3, 1, 1, 106.7000::float8, 10.7800::float8),
    ('00000000-0000-4000-8000-00000000f102'::uuid, 'C48SEED0002', 2, 0, 1, 107.6000::float8, 16.0500::float8),
    ('00000000-0000-4000-8000-00000000f103'::uuid, 'C48SEED0003', 4, 2, 0, 105.8500::float8, 21.0500::float8),
    ('00000000-0000-4000-8000-00000000f104'::uuid, 'C48SEED0004', 5, 1, 1, 106.7200::float8, 10.8000::float8),
    ('00000000-0000-4000-8000-00000000f105'::uuid, 'C48SEED0005', 1, 0, 1, 107.6500::float8, 16.1000::float8),
    ('00000000-0000-4000-8000-00000000f106'::uuid, 'C48SEED0006', 3, 1, 1, 105.9000::float8, 21.0200::float8),
    ('00000000-0000-4000-8000-00000000f107'::uuid, 'C48SEED0007', 4, 1, 0, 106.6800::float8, 10.7400::float8),
    ('00000000-0000-4000-8000-00000000f108'::uuid, 'C48SEED0008', 2, 0, 1, 107.5500::float8, 16.1200::float8),
    ('00000000-0000-4000-8000-00000000f109'::uuid, 'C48SEED0009', 6, 2, 1, 105.8200::float8, 21.0800::float8),
    ('00000000-0000-4000-8000-00000000f10a'::uuid, 'C48SEED0010', 3, 0, 1, 106.7500::float8, 10.8200::float8),
    ('00000000-0000-4000-8000-00000000f10b'::uuid, 'C48SEED0011', 4, 1, 1, 107.6200::float8, 16.0800::float8),
    ('00000000-0000-4000-8000-00000000f10c'::uuid, 'C48SEED0012', 2, 0, 1, 105.8800::float8, 21.1000::float8)
  ) AS fixture(id, tracking_code, people_affected, children_count, elderly_count, longitude, latitude)
  JOIN assistance_request request ON request.id = fixture.id AND request.tracking_code = fixture.tracking_code
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO request_event (id, request_id, actor_user_id, event_type, visibility, from_status, to_status, payload, occurred_at)
SELECT fixture.event_id, request.id, request.reporter_user_id, 'REQUEST_SUBMITTED', 'REPORTER', NULL::request_status, 'SUBMITTED'::request_status,
       '{"public_text_code":"RECEIVED"}'::jsonb, request.received_at
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000e1101'::uuid, '00000000-0000-4000-8000-00000000f101'::uuid, 'C48SEED0001'),
    ('00000000-0000-4000-8000-0000000e1102'::uuid, '00000000-0000-4000-8000-00000000f102'::uuid, 'C48SEED0002'),
    ('00000000-0000-4000-8000-0000000e1103'::uuid, '00000000-0000-4000-8000-00000000f103'::uuid, 'C48SEED0003'),
    ('00000000-0000-4000-8000-0000000e1104'::uuid, '00000000-0000-4000-8000-00000000f104'::uuid, 'C48SEED0004'),
    ('00000000-0000-4000-8000-0000000e1105'::uuid, '00000000-0000-4000-8000-00000000f105'::uuid, 'C48SEED0005'),
    ('00000000-0000-4000-8000-0000000e1106'::uuid, '00000000-0000-4000-8000-00000000f106'::uuid, 'C48SEED0006'),
    ('00000000-0000-4000-8000-0000000e1107'::uuid, '00000000-0000-4000-8000-00000000f107'::uuid, 'C48SEED0007'),
    ('00000000-0000-4000-8000-0000000e1108'::uuid, '00000000-0000-4000-8000-00000000f108'::uuid, 'C48SEED0008'),
    ('00000000-0000-4000-8000-0000000e1109'::uuid, '00000000-0000-4000-8000-00000000f109'::uuid, 'C48SEED0009'),
    ('00000000-0000-4000-8000-0000000e1110'::uuid, '00000000-0000-4000-8000-00000000f10a'::uuid, 'C48SEED0010'),
    ('00000000-0000-4000-8000-0000000e1111'::uuid, '00000000-0000-4000-8000-00000000f10b'::uuid, 'C48SEED0011'),
    ('00000000-0000-4000-8000-0000000e1112'::uuid, '00000000-0000-4000-8000-00000000f10c'::uuid, 'C48SEED0012')
  ) AS fixture(event_id, request_id, tracking_code)
  JOIN assistance_request request ON request.id = fixture.request_id AND request.tracking_code = fixture.tracking_code
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO request_event (id, request_id, actor_user_id, event_type, visibility, from_status, to_status, payload, occurred_at)
SELECT fixture.event_id, request.id, '00000000-0000-4000-8000-000000000118', 'VERIFICATION_STARTED', 'REPORTER', 'SUBMITTED'::request_status, 'VERIFYING'::request_status,
       '{"public_text_code":"VERIFYING"}'::jsonb, request.verifying_since
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000e1113'::uuid, '00000000-0000-4000-8000-00000000f109'::uuid, 'C48SEED0009'),
    ('00000000-0000-4000-8000-0000000e1114'::uuid, '00000000-0000-4000-8000-00000000f10a'::uuid, 'C48SEED0010'),
    ('00000000-0000-4000-8000-0000000e1115'::uuid, '00000000-0000-4000-8000-00000000f10b'::uuid, 'C48SEED0011'),
    ('00000000-0000-4000-8000-0000000e1116'::uuid, '00000000-0000-4000-8000-00000000f10c'::uuid, 'C48SEED0012')
  ) AS fixture(event_id, request_id, tracking_code)
  JOIN assistance_request request ON request.id = fixture.request_id AND request.tracking_code = fixture.tracking_code
 WHERE request.status = 'VERIFYING'
ON CONFLICT DO NOTHING;
