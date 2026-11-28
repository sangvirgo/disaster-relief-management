-- Additive synthetic Response fixtures. Safe to apply more than once.
INSERT INTO incident_category (code, display_name) VALUES
  ('FLOOD', 'Ngập lụt'), ('LANDSLIDE', 'Sạt lở đất'), ('STORM', 'Bão, gió lốc'), ('MEDICAL', 'Cấp cứu y tế'),
  ('TRAPPED', 'Người bị mắc kẹt'), ('OTHER', 'Khác')
ON CONFLICT DO NOTHING;

-- Refresh only unreviewed demo fixtures; leave any staff-reviewed result untouched.
UPDATE ai_advisory
   SET model = 'demo-fixture:gemini-3.5-flash-lite',
       input_hash = '824598ae1da193ac5043427709ffc34476616cdbe073471ac03af8279020c622',
       prompt_version = 'v3',
       schema_version = 'v4',
       risk_score = NULL,
       reason_codes = ARRAY['DECLARED_LIFE_DANGER','CHILDREN_PRESENT','ELDERLY_PRESENT','RESCUE_REQUESTED'],
       extracted_json = '{"summary":"Một vụ hỏa hoạn đang xảy ra ảnh hưởng đến 6 người, trong đó có 2 trẻ em và 1 người cao tuổi, yêu cầu cứu hộ khẩn cấp.","indicators":["Cháy","Cần cứu hộ","Có trẻ em","Có người cao tuổi"],"facts":{"people_affected":6,"children_count":2,"elderly_count":1,"life_threat":true,"needs_rescue":true,"needs_relief_supplies":false},"priority_score":90,"priority_reasons":["Sự cố hỏa hoạn đe dọa trực tiếp đến tính mạng","Có sự hiện diện của trẻ em trong khu vực nguy hiểm","Có người cao tuổi cần hỗ trợ đặc biệt","Tổng số người bị ảnh hưởng là 6","Yêu cầu cứu hộ khẩn cấp đã được xác nhận"],"confidence":0.95}'::jsonb
 WHERE id = '00000000-0000-4000-8000-000000000af1'::uuid
   AND status = 'COMPLETED'
   AND review_status IS NULL;

UPDATE ai_advisory
   SET model = 'demo-fixture:gemini-3.5-flash-lite',
       input_hash = '3f39da9bcc687cf1a89dcaf28b3ba4108e65e1dec137e3769162c7a8d015a78a',
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

INSERT INTO rescue_team (id, name, team_kind, reporting_mode, external_contact_note,
                         affiliation_verified_at, affiliation_verified_by, availability) VALUES
  ('00000000-0000-4000-8000-0000000000a9',
   'Đội xuồng cứu hộ Bắc', 'VOLUNTEER', 'APP', NULL, now() - interval '2 days',
   '00000000-0000-4000-8000-000000000118', 'AVAILABLE'),
  ('00000000-0000-4000-8000-0000000000aa',
   'Đội sơ cứu lưu động Nam', 'VOLUNTEER', 'APP', NULL, now() - interval '2 days',
   '00000000-0000-4000-8000-000000000118', 'AVAILABLE'),
  ('00000000-0000-4000-8000-0000000000ab',
   'Đội hỗ trợ cơ động Trung', 'GOVERNMENT', 'COORDINATOR', 'Liên lạc qua điều phối viên, đội hình giả lập.',
   now() - interval '2 days', '00000000-0000-4000-8000-000000000118', 'AVAILABLE'),
  ('00000000-0000-4000-8000-0000000000ac',
   'Đội y tế cộng đồng Bắc', 'GOVERNMENT', 'COORDINATOR', 'Liên lạc qua điều phối viên, đội hình giả lập.',
   now() - interval '1 day', '00000000-0000-4000-8000-000000000118', 'AVAILABLE'),
  ('00000000-0000-4000-8000-0000000000ad',
   'Đội xuồng cứu hộ Nam', 'GOVERNMENT', 'COORDINATOR', 'Liên lạc qua điều phối viên, đội xuồng giả lập.',
   now() - interval '1 day', '00000000-0000-4000-8000-000000000118', 'AVAILABLE'),
  ('00000000-0000-4000-8000-0000000000ae',
   'Đội cứu hộ cơ động Bắc', 'VOLUNTEER', 'APP', NULL,
   now() - interval '1 day', '00000000-0000-4000-8000-000000000118', 'AVAILABLE')
ON CONFLICT DO NOTHING;

INSERT INTO team_member (team_id, user_id, member_role)
SELECT team.id, fixture.user_id, fixture.member_role
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000000a9'::uuid, 'Đội xuồng cứu hộ Bắc', 'VOLUNTEER', 'APP', '00000000-0000-4000-8000-000000000114'::uuid, 'LEADER'),
    ('00000000-0000-4000-8000-0000000000a9'::uuid, 'Đội xuồng cứu hộ Bắc', 'VOLUNTEER', 'APP', '00000000-0000-4000-8000-000000000115'::uuid, 'MEMBER'),
    ('00000000-0000-4000-8000-0000000000aa'::uuid, 'Đội sơ cứu lưu động Nam', 'VOLUNTEER', 'APP', '00000000-0000-4000-8000-000000000116'::uuid, 'LEADER'),
    ('00000000-0000-4000-8000-0000000000aa'::uuid, 'Đội sơ cứu lưu động Nam', 'VOLUNTEER', 'APP', '00000000-0000-4000-8000-000000000117'::uuid, 'MEMBER'),
    ('00000000-0000-4000-8000-0000000000ae'::uuid, 'Đội cứu hộ cơ động Bắc', 'VOLUNTEER', 'APP', '00000000-0000-4000-8000-000000000119'::uuid, 'LEADER')
  ) AS fixture(team_id, team_name, team_kind, reporting_mode, user_id, member_role)
  JOIN rescue_team team ON team.id = fixture.team_id AND team.name = fixture.team_name
                       AND team.team_kind = fixture.team_kind AND team.reporting_mode = fixture.reporting_mode
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO team_skill (team_id, skill_code)
SELECT team.id, fixture.skill_code
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000000a9'::uuid, 'Đội xuồng cứu hộ Bắc', 'VOLUNTEER', 'APP', 'BOAT'),
    ('00000000-0000-4000-8000-0000000000a9'::uuid, 'Đội xuồng cứu hộ Bắc', 'VOLUNTEER', 'APP', 'FIRST_AID'),
    ('00000000-0000-4000-8000-0000000000aa'::uuid, 'Đội sơ cứu lưu động Nam', 'VOLUNTEER', 'APP', 'FIRST_AID'),
    ('00000000-0000-4000-8000-0000000000aa'::uuid, 'Đội sơ cứu lưu động Nam', 'VOLUNTEER', 'APP', 'TRUCK_DRIVER'),
    ('00000000-0000-4000-8000-0000000000ab'::uuid, 'Đội hỗ trợ cơ động Trung', 'GOVERNMENT', 'COORDINATOR', 'RADIO'),
    ('00000000-0000-4000-8000-0000000000ab'::uuid, 'Đội hỗ trợ cơ động Trung', 'GOVERNMENT', 'COORDINATOR', 'TRUCK_DRIVER'),
    ('00000000-0000-4000-8000-0000000000ac'::uuid, 'Đội y tế cộng đồng Bắc', 'GOVERNMENT', 'COORDINATOR', 'FIRST_AID'),
    ('00000000-0000-4000-8000-0000000000ac'::uuid, 'Đội y tế cộng đồng Bắc', 'GOVERNMENT', 'COORDINATOR', 'CLIMBING'),
    ('00000000-0000-4000-8000-0000000000ad'::uuid, 'Đội xuồng cứu hộ Nam', 'GOVERNMENT', 'COORDINATOR', 'BOAT'),
    ('00000000-0000-4000-8000-0000000000ae'::uuid, 'Đội cứu hộ cơ động Bắc', 'VOLUNTEER', 'APP', 'BOAT')
  ) AS fixture(team_id, team_name, team_kind, reporting_mode, skill_code)
  JOIN rescue_team team ON team.id = fixture.team_id AND team.name = fixture.team_name
                       AND team.team_kind = fixture.team_kind AND team.reporting_mode = fixture.reporting_mode
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO team_position (team_id, location, accuracy_m, captured_at, source, set_by_user_id)
SELECT team.id, ST_SetSRID(ST_MakePoint(fixture.longitude, fixture.latitude), 4326)::geography,
       NULL, now(), 'COORDINATOR_REPORTED', '00000000-0000-4000-8000-000000000118'
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000000a9'::uuid, 'Đội xuồng cứu hộ Bắc', 'VOLUNTEER', 'APP', 105.8500::float8, 21.0300::float8),
    ('00000000-0000-4000-8000-0000000000aa'::uuid, 'Đội sơ cứu lưu động Nam', 'VOLUNTEER', 'APP', 106.7000::float8, 10.7800::float8),
    ('00000000-0000-4000-8000-0000000000ab'::uuid, 'Đội hỗ trợ cơ động Trung', 'GOVERNMENT', 'COORDINATOR', 107.6000::float8, 16.0700::float8),
    ('00000000-0000-4000-8000-0000000000ac'::uuid, 'Đội y tế cộng đồng Bắc', 'GOVERNMENT', 'COORDINATOR', 105.8700::float8, 21.0500::float8),
    ('00000000-0000-4000-8000-0000000000ad'::uuid, 'Đội xuồng cứu hộ Nam', 'GOVERNMENT', 'COORDINATOR', 106.7000::float8, 10.7800::float8),
    ('00000000-0000-4000-8000-0000000000ae'::uuid, 'Đội cứu hộ cơ động Bắc', 'VOLUNTEER', 'APP', 105.8600::float8, 21.0400::float8)
  ) AS fixture(team_id, team_name, team_kind, reporting_mode, longitude, latitude)
  JOIN rescue_team team ON team.id = fixture.team_id AND team.name = fixture.team_name
                       AND team.team_kind = fixture.team_kind AND team.reporting_mode = fixture.reporting_mode
 WHERE true
ON CONFLICT (team_id) DO UPDATE SET
  location = EXCLUDED.location,
  accuracy_m = EXCLUDED.accuracy_m,
  captured_at = EXCLUDED.captured_at,
  source = EXCLUDED.source,
  set_by_user_id = EXCLUDED.set_by_user_id;

-- Three additional APP-led northern teams for the terrain-rescue demo.
-- Positions are initial synthetic fixtures; leaders must refresh them after 30 minutes.
INSERT INTO rescue_team (id, name, team_kind, reporting_mode,
                         affiliation_verified_at, affiliation_verified_by, availability) VALUES
  ('00000000-0000-4000-8000-0000000000af',
   'Đội cứu hộ địa hình Bắc 1', 'VOLUNTEER', 'APP', now(), '00000000-0000-4000-8000-000000000118', 'AVAILABLE'),
  ('00000000-0000-4000-8000-0000000000b0',
   'Đội cứu hộ địa hình Bắc 2', 'VOLUNTEER', 'APP', now(), '00000000-0000-4000-8000-000000000118', 'AVAILABLE'),
  ('00000000-0000-4000-8000-0000000000b1',
   'Đội cứu hộ đa năng Bắc', 'VOLUNTEER', 'APP', now(), '00000000-0000-4000-8000-000000000118', 'AVAILABLE')
ON CONFLICT DO NOTHING;

INSERT INTO team_member (team_id, user_id, member_role)
SELECT t.id, fixture.leader_id, 'LEADER'
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000000af'::uuid, 'Đội cứu hộ địa hình Bắc 1', '00000000-0000-4000-8000-000000000120'::uuid),
    ('00000000-0000-4000-8000-0000000000b0'::uuid, 'Đội cứu hộ địa hình Bắc 2', '00000000-0000-4000-8000-000000000121'::uuid),
    ('00000000-0000-4000-8000-0000000000b1'::uuid, 'Đội cứu hộ đa năng Bắc', '00000000-0000-4000-8000-000000000122'::uuid)
  ) AS fixture(team_id, team_name, leader_id)
  JOIN rescue_team t ON t.id=fixture.team_id AND t.name=fixture.team_name
ON CONFLICT DO NOTHING;

INSERT INTO team_skill (team_id, skill_code)
SELECT t.id, fixture.skill_code
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000000af'::uuid, 'Đội cứu hộ địa hình Bắc 1', 'CLIMBING'),
    ('00000000-0000-4000-8000-0000000000b0'::uuid, 'Đội cứu hộ địa hình Bắc 2', 'CLIMBING'),
    ('00000000-0000-4000-8000-0000000000b0'::uuid, 'Đội cứu hộ địa hình Bắc 2', 'FIRST_AID'),
    ('00000000-0000-4000-8000-0000000000b1'::uuid, 'Đội cứu hộ đa năng Bắc', 'CLIMBING'),
    ('00000000-0000-4000-8000-0000000000b1'::uuid, 'Đội cứu hộ đa năng Bắc', 'BOAT')
  ) AS fixture(team_id, team_name, skill_code)
  JOIN rescue_team t ON t.id=fixture.team_id AND t.name=fixture.team_name
ON CONFLICT DO NOTHING;

INSERT INTO team_position (team_id, location, accuracy_m, captured_at, source, set_by_user_id)
SELECT t.id, ST_SetSRID(ST_MakePoint(fixture.longitude, fixture.latitude), 4326)::geography,
       NULL, now(), 'COORDINATOR_REPORTED', '00000000-0000-4000-8000-000000000118'
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000000af'::uuid, 'Đội cứu hộ địa hình Bắc 1', 105.8450::float8, 21.0280::float8),
    ('00000000-0000-4000-8000-0000000000b0'::uuid, 'Đội cứu hộ địa hình Bắc 2', 105.8550::float8, 21.0150::float8),
    ('00000000-0000-4000-8000-0000000000b1'::uuid, 'Đội cứu hộ đa năng Bắc', 105.8500::float8, 21.0350::float8)
  ) AS fixture(team_id, team_name, longitude, latitude)
  JOIN rescue_team t ON t.id=fixture.team_id AND t.name=fixture.team_name
ON CONFLICT (team_id) DO UPDATE SET
  location = EXCLUDED.location,
  accuracy_m = EXCLUDED.accuracy_m,
  captured_at = EXCLUDED.captured_at,
  source = EXCLUDED.source,
  set_by_user_id = EXCLUDED.set_by_user_id;

INSERT INTO assistance_request (id, tracking_code, tracking_secret_hash, campaign_id, incident_category_code, report_mode,
                                reporter_user_id, reporter_name, reporter_contact_phone, description,
                                status, verifying_since, received_at)
SELECT fixture.id, fixture.tracking_code, fixture.tracking_secret_hash, fixture.campaign_id, fixture.category_code, 'SELF',
       fixture.reporter_user_id, fixture.reporter_name, fixture.phone, fixture.description,
       fixture.status::request_status, fixture.verifying_since, fixture.received_at
  FROM (VALUES
    ('00000000-0000-4000-8000-00000000f101'::uuid, 'C48SEED0001', NULL::text, '00000000-0000-4000-8000-0000000000c3'::uuid, 'FLOOD', 'SUBMITTED', NULL::timestamptz, now() - interval '3 hours', 'Ngập vào sân nhà, cần hỗ trợ di chuyển đồ dùng.', '0900000301', '00000000-0000-4000-8000-000000000113'::uuid, 'Người dân 3'),
    ('00000000-0000-4000-8000-00000000f102'::uuid, 'C48SEED0002', 'demo$seed-expansion$0002', '00000000-0000-4000-8000-0000000000c4'::uuid, 'STORM', 'SUBMITTED', NULL::timestamptz, now() - interval '160 minutes', 'Mái tôn bị tốc sau gió lớn, gia đình đang ở nơi an toàn.', '0900000302', NULL::uuid, 'Người báo 02'),
    ('00000000-0000-4000-8000-00000000f103'::uuid, 'C48SEED0003', NULL::text, '00000000-0000-4000-8000-0000000000c5'::uuid, 'LANDSLIDE', 'SUBMITTED', NULL::timestamptz, now() - interval '145 minutes', 'Đất đá tràn ra lối đi, cần kiểm tra tuyến đường.', '0900000303', '00000000-0000-4000-8000-000000000113'::uuid, 'Người dân 3'),
    ('00000000-0000-4000-8000-00000000f104'::uuid, 'C48SEED0004', 'demo$seed-expansion$0004', '00000000-0000-4000-8000-0000000000c6'::uuid, 'FLOOD', 'SUBMITTED', NULL::timestamptz, now() - interval '120 minutes', 'Nước ngập tuyến đường trước nhà, cần hướng dẫn di chuyển.', '0900000304', NULL::uuid, 'Người báo 04'),
    ('00000000-0000-4000-8000-00000000f105'::uuid, 'C48SEED0005', NULL::text, '00000000-0000-4000-8000-0000000000c7'::uuid, 'MEDICAL', 'SUBMITTED', NULL::timestamptz, now() - interval '100 minutes', 'Người thân cần được hỗ trợ y tế tại điểm sơ tán.', '0900000305', '00000000-0000-4000-8000-000000000113'::uuid, 'Người dân 3'),
    ('00000000-0000-4000-8000-00000000f106'::uuid, 'C48SEED0006', 'demo$seed-expansion$0006', '00000000-0000-4000-8000-0000000000c8'::uuid, 'STORM', 'SUBMITTED', NULL::timestamptz, now() - interval '80 minutes', 'Cây đổ chắn lối vào khu dân cư, chưa ghi nhận người bị thương.', '0900000306', NULL::uuid, 'Người báo 06'),
    ('00000000-0000-4000-8000-00000000f107'::uuid, 'C48SEED0007', NULL::text, '00000000-0000-4000-8000-0000000000c3'::uuid, 'FLOOD', 'SUBMITTED', NULL::timestamptz, now() - interval '60 minutes', 'Một hộ cần nước uống và hỗ trợ kiểm tra an toàn.', '0900000307', '00000000-0000-4000-8000-000000000113'::uuid, 'Người dân 3'),
    ('00000000-0000-4000-8000-00000000f108'::uuid, 'C48SEED0008', 'demo$seed-expansion$0008', '00000000-0000-4000-8000-0000000000c4'::uuid, 'OTHER', 'SUBMITTED', NULL::timestamptz, now() - interval '50 minutes', 'Nước sinh hoạt bị gián đoạn sau mưa lớn.', '0900000308', NULL::uuid, 'Người báo 08'),
    ('00000000-0000-4000-8000-00000000f109'::uuid, 'C48SEED0009', NULL::text, '00000000-0000-4000-8000-0000000000c5'::uuid, 'LANDSLIDE', 'VERIFYING', now() - interval '30 minutes', now() - interval '45 minutes', 'Có vết nứt mới trên taluy gần nhà, đang chờ xác minh.', '0900000309', '00000000-0000-4000-8000-000000000113'::uuid, 'Người dân 3'),
    ('00000000-0000-4000-8000-00000000f10a'::uuid, 'C48SEED0010', 'demo$seed-expansion$0010', '00000000-0000-4000-8000-0000000000c6'::uuid, 'FLOOD', 'VERIFYING', now() - interval '25 minutes', now() - interval '40 minutes', 'Nước vào tầng trệt, cần xác nhận số người và tình hình hiện trường.', '0900000310', NULL::uuid, 'Người báo 10'),
    ('00000000-0000-4000-8000-00000000f10b'::uuid, 'C48SEED0011', NULL::text, '00000000-0000-4000-8000-0000000000c7'::uuid, 'MEDICAL', 'VERIFYING', now() - interval '20 minutes', now() - interval '35 minutes', 'Người cao tuổi cần hỗ trợ sơ cứu tại nơi trú tạm.', '0900000311', '00000000-0000-4000-8000-000000000113'::uuid, 'Người dân 3'),
    ('00000000-0000-4000-8000-00000000f10c'::uuid, 'C48SEED0012', 'demo$seed-expansion$0012', '00000000-0000-4000-8000-0000000000c8'::uuid, 'STORM', 'VERIFYING', now() - interval '15 minutes', now() - interval '30 minutes', 'Mái che bị hư hỏng, hộ dân đã đến điểm trú tạm.', '0900000312', NULL::uuid, 'Người báo 12')
  ) AS fixture(id, tracking_code, tracking_secret_hash, campaign_id, category_code, status, verifying_since,
               received_at, description, phone, reporter_user_id, reporter_name)
  JOIN campaign ON campaign.id = fixture.campaign_id
               AND campaign.name = CASE fixture.campaign_id
                 WHEN '00000000-0000-4000-8000-0000000000c3'::uuid THEN 'Hỗ trợ khẩn cấp TP. Hồ Chí Minh'
                 WHEN '00000000-0000-4000-8000-0000000000c4'::uuid THEN 'Tiếp tế vùng duyên hải Đà Nẵng'
                 WHEN '00000000-0000-4000-8000-0000000000c5'::uuid THEN 'Cứu trợ hộ dân Lào Cai'
                 WHEN '00000000-0000-4000-8000-0000000000c6'::uuid THEN 'Nước sạch và nhu yếu phẩm Huế'
                 WHEN '00000000-0000-4000-8000-0000000000c7'::uuid THEN 'Hỗ trợ sơ tán và an sinh Cần Thơ'
                 WHEN '00000000-0000-4000-8000-0000000000c8'::uuid THEN 'Cứu trợ y tế Nghệ An'
               END
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO request_subject (request_id, people_affected, children_count, elderly_count, location, location_source)
SELECT fixture.id, fixture.people_affected, fixture.children_count, fixture.elderly_count,
       ST_SetSRID(ST_MakePoint(fixture.longitude, fixture.latitude), 4326)::geography, 'MANUAL_PIN'
  FROM (VALUES
    ('00000000-0000-4000-8000-00000000f101'::uuid, 'C48SEED0001', 3, 1, 1, 106.7000::float8, 10.7800::float8),
    ('00000000-0000-4000-8000-00000000f102'::uuid, 'C48SEED0002', 2, 0, 1, 108.2000::float8, 16.0500::float8),
    ('00000000-0000-4000-8000-00000000f103'::uuid, 'C48SEED0003', 4, 2, 0, 105.8500::float8, 21.0500::float8),
    ('00000000-0000-4000-8000-00000000f104'::uuid, 'C48SEED0004', 5, 1, 1, 107.5900::float8, 16.4700::float8),
    ('00000000-0000-4000-8000-00000000f105'::uuid, 'C48SEED0005', 1, 0, 1, 105.7500::float8, 10.0500::float8),
    ('00000000-0000-4000-8000-00000000f106'::uuid, 'C48SEED0006', 3, 1, 1, 105.6900::float8, 18.6800::float8),
    ('00000000-0000-4000-8000-00000000f107'::uuid, 'C48SEED0007', 4, 1, 0, 106.6800::float8, 10.7400::float8),
    ('00000000-0000-4000-8000-00000000f108'::uuid, 'C48SEED0008', 2, 0, 1, 108.2300::float8, 16.0700::float8),
    ('00000000-0000-4000-8000-00000000f109'::uuid, 'C48SEED0009', 6, 2, 1, 103.9800::float8, 22.5000::float8),
    ('00000000-0000-4000-8000-00000000f10a'::uuid, 'C48SEED0010', 3, 0, 1, 107.6100::float8, 16.4500::float8),
    ('00000000-0000-4000-8000-00000000f10b'::uuid, 'C48SEED0011', 4, 1, 1, 105.7600::float8, 10.0600::float8),
    ('00000000-0000-4000-8000-00000000f10c'::uuid, 'C48SEED0012', 2, 0, 1, 105.7000::float8, 18.6900::float8)
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

-- Verified, human-triaged P1 request with no active mission for campaign/team coordination demos.
UPDATE assistance_request
   SET status='VERIFYING',verifying_since=COALESCE(verifying_since,now()-interval '59 minutes'),version=version+1
 WHERE id='00000000-0000-4000-8000-00000000f107' AND status='SUBMITTED';

INSERT INTO request_event (id,request_id,actor_user_id,event_type,visibility,from_status,to_status,payload,occurred_at)
SELECT '00000000-0000-4000-8000-0000000e1213',request.id,'00000000-0000-4000-8000-000000000102',
       'VERIFICATION_STARTED','REPORTER','SUBMITTED','VERIFYING',
       '{"public_text_code":"VERIFYING"}'::jsonb,request.verifying_since
  FROM assistance_request request
 WHERE request.id='00000000-0000-4000-8000-00000000f107' AND request.verifying_since IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO request_event (id,request_id,actor_user_id,event_type,visibility,from_status,to_status,payload,occurred_at)
SELECT '00000000-0000-4000-8000-0000000e1214',request.id,'00000000-0000-4000-8000-000000000102',
       'VERIFICATION_APPROVED','REPORTER','VERIFYING','VERIFIED',
       jsonb_build_object('public_text_code','VERIFIED','snapshot',jsonb_build_object(
         'incident_category_code',request.incident_category_code,'people_affected',subject.people_affected,
         'children_count',subject.children_count,'elderly_count',subject.elderly_count,
         'life_threat',request.reporter_declared_danger,'needs_rescue',request.needs_rescue,
         'needs_relief_supplies',request.needs_relief_supplies)),
       now()-interval '58 minutes'
  FROM assistance_request request JOIN request_subject subject ON subject.request_id=request.id
 WHERE request.id='00000000-0000-4000-8000-00000000f107'
ON CONFLICT (id) DO NOTHING;

INSERT INTO verification_decision (id,request_id,outcome,basis,reviewer_user_id,reason,reason_kind,decided_at)
SELECT '00000000-0000-4000-8000-00000000d108',request.id,'VERIFIED','CONTACT_CONFIRMED',
       '00000000-0000-4000-8000-000000000102',NULL,NULL,now()-interval '58 minutes'
  FROM assistance_request request
 WHERE request.id='00000000-0000-4000-8000-00000000f107'
ON CONFLICT (id) DO NOTHING;

UPDATE assistance_request
   SET verification_revision='00000000-0000-4000-8000-0000000e1214',
       status=CASE WHEN status='VERIFYING' THEN 'VERIFIED'::request_status ELSE status END,
       verifying_since=CASE WHEN status='VERIFYING' THEN NULL ELSE verifying_since END,
       version=version+1
 WHERE id='00000000-0000-4000-8000-00000000f107'
   AND verification_revision IS NULL
   AND status IN ('VERIFYING','VERIFIED','TRIAGED');

-- ---------- Campaign-attribution demo SOS (C48CAM*): inside one campaign, inside two, outside every campaign ----------
-- Attribution is derived from the campaign areas with the same PostGIS rule the API uses (ACTIVE campaigns only).
INSERT INTO assistance_request (id, tracking_code, incident_category_code, report_mode, status, verifying_since, received_at,
                                description, reporter_contact_phone, reporter_name)
SELECT fixture.id, fixture.tracking_code, fixture.category_code, 'SELF', fixture.status::request_status, fixture.verifying_since,
       fixture.received_at, fixture.description, fixture.phone, fixture.reporter_name
  FROM (VALUES
    ('00000000-0000-4000-8000-00000000f201'::uuid, 'C48CAM00A01', 'FLOOD', 'SUBMITTED', NULL::timestamptz, now() - interval '17 minutes', 'Nước dâng vào nhà, cần hỗ trợ di dời người già và trẻ nhỏ.', '0900400001', 'Người báo A01'),
    ('00000000-0000-4000-8000-00000000f202'::uuid, 'C48CAM00A02', 'TRAPPED', 'SUBMITTED', NULL::timestamptz, now() - interval '24 minutes', 'Người cao tuổi mắc kẹt tầng trệt do nước chảy xiết.', '0900400002', 'Người báo A02'),
    ('00000000-0000-4000-8000-00000000f203'::uuid, 'C48CAM00A03', 'STORM', 'VERIFYING', now() - interval '23 minutes', now() - interval '31 minutes', 'Gió lớn làm sập mái nhà, gia đình cần chỗ trú tạm.', '0900400003', 'Người báo A03'),
    ('00000000-0000-4000-8000-00000000f204'::uuid, 'C48CAM00A04', 'MEDICAL', 'SUBMITTED', NULL::timestamptz, now() - interval '38 minutes', 'Người bệnh cần hỗ trợ y tế, đường vào bị ngập.', '0900400004', 'Người báo A04'),
    ('00000000-0000-4000-8000-00000000f205'::uuid, 'C48CAM00A05', 'LANDSLIDE', 'SUBMITTED', NULL::timestamptz, now() - interval '45 minutes', 'Sạt lở chặn đường vào bản, cần kiểm tra an toàn.', '0900400005', 'Người báo A05'),
    ('00000000-0000-4000-8000-00000000f206'::uuid, 'C48CAM00B01', 'FLOOD', 'SUBMITTED', NULL::timestamptz, now() - interval '52 minutes', 'Khu dân cư bị cô lập bởi nước lũ, cần xuồng cứu hộ.', '0900400006', 'Người báo B01'),
    ('00000000-0000-4000-8000-00000000f207'::uuid, 'C48CAM00B02', 'TRAPPED', 'VERIFYING', now() - interval '27 minutes', now() - interval '59 minutes', 'Gia đình mắc kẹt trên tầng hai, nước còn dâng.', '0900400007', 'Người báo B02'),
    ('00000000-0000-4000-8000-00000000f208'::uuid, 'C48CAM00B03', 'MEDICAL', 'SUBMITTED', NULL::timestamptz, now() - interval '66 minutes', 'Người già khó thở, cần sơ cứu tại chỗ.', '0900400008', 'Người báo B03'),
    ('00000000-0000-4000-8000-00000000f209'::uuid, 'C48CAM00C01', 'FLOOD', 'SUBMITTED', NULL::timestamptz, now() - interval '73 minutes', 'Nước ngập đường, cần nhu yếu phẩm cho 4 người.', '0900400009', 'Người báo C01'),
    ('00000000-0000-4000-8000-00000000f20a'::uuid, 'C48CAM00C02', 'STORM', 'SUBMITTED', NULL::timestamptz, now() - interval '80 minutes', 'Cây đổ chắn lối vào nhà, cần hỗ trợ dọn dẹp.', '0900400010', 'Người báo C02'),
    ('00000000-0000-4000-8000-00000000f20b'::uuid, 'C48CAM00C03', 'FLOOD', 'SUBMITTED', NULL::timestamptz, now() - interval '87 minutes', 'Ngập sâu, cần cứu trợ lương thực và nước sạch.', '0900400011', 'Người báo C03'),
    ('00000000-0000-4000-8000-00000000f20c'::uuid, 'C48CAM00C04', 'FLOOD', 'SUBMITTED', NULL::timestamptz, now() - interval '94 minutes', 'Nước tràn vào khu nhà, cần hỗ trợ di dời.', '0900400012', 'Người báo C04'),
    ('00000000-0000-4000-8000-00000000f20d'::uuid, 'C48CAM00C05', 'TRAPPED', 'SUBMITTED', NULL::timestamptz, now() - interval '101 minutes', 'Người già và trẻ nhỏ chờ cứu hộ trên mái nhà.', '0900400013', 'Người báo C05'),
    ('00000000-0000-4000-8000-00000000f20e'::uuid, 'C48CAM00C06', 'MEDICAL', 'VERIFYING', now() - interval '34 minutes', now() - interval '108 minutes', 'Cần hỗ trợ y tế khẩn cho người cao tuổi.', '0900400014', 'Người báo C06'),
    ('00000000-0000-4000-8000-00000000f20f'::uuid, 'C48CAM00C07', 'FLOOD', 'SUBMITTED', NULL::timestamptz, now() - interval '115 minutes', 'Nằm ngay sát ngoài vùng chiến dịch Nam, cần hỗ trợ nước uống.', '0900400015', 'Người báo C07')
  ) AS fixture(id, tracking_code, category_code, status, verifying_since, received_at, description, phone, reporter_name)
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO request_subject (request_id, people_affected, children_count, elderly_count, location, location_source)
SELECT fixture.id, fixture.people_affected, fixture.children_count, fixture.elderly_count,
       ST_SetSRID(ST_MakePoint(fixture.longitude, fixture.latitude), 4326)::geography, 'MANUAL_PIN'
  FROM (VALUES
    ('00000000-0000-4000-8000-00000000f201'::uuid, 'C48CAM00A01', 4, 1, 1, 106.6900::float8, 10.7900::float8),
    ('00000000-0000-4000-8000-00000000f202'::uuid, 'C48CAM00A02', 3, 0, 1, 106.7500::float8, 10.7400::float8),
    ('00000000-0000-4000-8000-00000000f203'::uuid, 'C48CAM00A03', 2, 0, 0, 108.2100::float8, 16.0600::float8),
    ('00000000-0000-4000-8000-00000000f204'::uuid, 'C48CAM00A04', 1, 0, 1, 105.7500::float8, 10.0500::float8),
    ('00000000-0000-4000-8000-00000000f205'::uuid, 'C48CAM00A05', 5, 2, 0, 103.9800::float8, 22.4900::float8),
    ('00000000-0000-4000-8000-00000000f206'::uuid, 'C48CAM00B01', 6, 2, 1, 105.8700::float8, 21.0300::float8),
    ('00000000-0000-4000-8000-00000000f207'::uuid, 'C48CAM00B02', 3, 1, 0, 105.8900::float8, 21.0400::float8),
    ('00000000-0000-4000-8000-00000000f208'::uuid, 'C48CAM00B03', 2, 0, 1, 105.8800::float8, 21.0200::float8),
    ('00000000-0000-4000-8000-00000000f209'::uuid, 'C48CAM00C01', 4, 1, 0, 107.5900::float8, 16.4600::float8),
    ('00000000-0000-4000-8000-00000000f20a'::uuid, 'C48CAM00C02', 2, 0, 1, 108.4400::float8, 11.9400::float8),
    ('00000000-0000-4000-8000-00000000f20b'::uuid, 'C48CAM00C03', 5, 1, 1, 105.6900::float8, 18.6700::float8),
    ('00000000-0000-4000-8000-00000000f20c'::uuid, 'C48CAM00C04', 3, 1, 0, 106.6800::float8, 20.8600::float8),
    ('00000000-0000-4000-8000-00000000f20d'::uuid, 'C48CAM00C05', 4, 0, 2, 106.7000::float8, 20.8700::float8),
    ('00000000-0000-4000-8000-00000000f20e'::uuid, 'C48CAM00C06', 2, 0, 1, 106.6600::float8, 20.8500::float8),
    ('00000000-0000-4000-8000-00000000f20f'::uuid, 'C48CAM00C07', 3, 0, 0, 106.7000::float8, 11.0500::float8)
  ) AS fixture(id, tracking_code, people_affected, children_count, elderly_count, longitude, latitude)
  JOIN assistance_request request ON request.id = fixture.id AND request.tracking_code = fixture.tracking_code
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO request_event (id, request_id, actor_user_id, event_type, visibility, from_status, to_status, payload, occurred_at)
SELECT fixture.event_id, request.id, NULL, 'REQUEST_SUBMITTED', 'REPORTER', NULL::request_status, 'SUBMITTED'::request_status,
       '{"public_text_code":"RECEIVED"}'::jsonb, request.received_at
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000e1301'::uuid, '00000000-0000-4000-8000-00000000f201'::uuid, 'C48CAM00A01'),
    ('00000000-0000-4000-8000-0000000e1302'::uuid, '00000000-0000-4000-8000-00000000f202'::uuid, 'C48CAM00A02'),
    ('00000000-0000-4000-8000-0000000e1303'::uuid, '00000000-0000-4000-8000-00000000f203'::uuid, 'C48CAM00A03'),
    ('00000000-0000-4000-8000-0000000e1304'::uuid, '00000000-0000-4000-8000-00000000f204'::uuid, 'C48CAM00A04'),
    ('00000000-0000-4000-8000-0000000e1305'::uuid, '00000000-0000-4000-8000-00000000f205'::uuid, 'C48CAM00A05'),
    ('00000000-0000-4000-8000-0000000e1306'::uuid, '00000000-0000-4000-8000-00000000f206'::uuid, 'C48CAM00B01'),
    ('00000000-0000-4000-8000-0000000e1307'::uuid, '00000000-0000-4000-8000-00000000f207'::uuid, 'C48CAM00B02'),
    ('00000000-0000-4000-8000-0000000e1308'::uuid, '00000000-0000-4000-8000-00000000f208'::uuid, 'C48CAM00B03'),
    ('00000000-0000-4000-8000-0000000e1309'::uuid, '00000000-0000-4000-8000-00000000f209'::uuid, 'C48CAM00C01'),
    ('00000000-0000-4000-8000-0000000e130a'::uuid, '00000000-0000-4000-8000-00000000f20a'::uuid, 'C48CAM00C02'),
    ('00000000-0000-4000-8000-0000000e130b'::uuid, '00000000-0000-4000-8000-00000000f20b'::uuid, 'C48CAM00C03'),
    ('00000000-0000-4000-8000-0000000e130c'::uuid, '00000000-0000-4000-8000-00000000f20c'::uuid, 'C48CAM00C04'),
    ('00000000-0000-4000-8000-0000000e130d'::uuid, '00000000-0000-4000-8000-00000000f20d'::uuid, 'C48CAM00C05'),
    ('00000000-0000-4000-8000-0000000e130e'::uuid, '00000000-0000-4000-8000-00000000f20e'::uuid, 'C48CAM00C06'),
    ('00000000-0000-4000-8000-0000000e130f'::uuid, '00000000-0000-4000-8000-00000000f20f'::uuid, 'C48CAM00C07')
  ) AS fixture(event_id, request_id, tracking_code)
  JOIN assistance_request request ON request.id = fixture.request_id AND request.tracking_code = fixture.tracking_code
 WHERE true
ON CONFLICT (id) DO NOTHING;

WITH hits AS (
  SELECT r.id, array_agg(c.id ORDER BY c.id) AS campaign_ids
    FROM assistance_request r
    JOIN request_subject s ON s.request_id = r.id
    JOIN campaign c ON c.status = 'ACTIVE' AND c.center IS NOT NULL AND c.radius_m IS NOT NULL
                   AND ST_DWithin(c.center, s.location, c.radius_m)
   WHERE r.campaign_id IS NULL
     AND (r.tracking_code LIKE 'C48CAM%'
          OR (r.tracking_code LIKE 'C48DEM%' AND r.status IN ('SUBMITTED','VERIFYING','VERIFIED','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING')))
   GROUP BY r.id
)
UPDATE assistance_request r
   SET campaign_id = CASE WHEN cardinality(h.campaign_ids) = 1 THEN h.campaign_ids[1] ELSE NULL END,
       campaign_match_state = CASE WHEN cardinality(h.campaign_ids) = 1 THEN 'AUTO_ATTACHED' ELSE 'CONFLICT' END,
       campaign_candidate_ids = CASE WHEN cardinality(h.campaign_ids) = 1 THEN NULL ELSE h.campaign_ids END,
       version = r.version + 1
  FROM hits h
 WHERE r.id = h.id
   AND (r.campaign_match_state NOT IN ('AUTO_ATTACHED','CONFLICT','MANUAL'));

INSERT INTO request_event (id, request_id, actor_user_id, event_type, visibility, from_status, to_status, payload, occurred_at)
SELECT md5('c48-seed-cam-attribution:' || r.id::text)::uuid, r.id, NULL,
       CASE r.campaign_match_state WHEN 'AUTO_ATTACHED' THEN 'CAMPAIGN_AUTO_ATTACHED' ELSE 'CAMPAIGN_MATCH_CONFLICT' END,
       'STAFF', r.status, r.status,
       CASE r.campaign_match_state
         WHEN 'AUTO_ATTACHED' THEN jsonb_build_object('campaign_id', r.campaign_id, 'campaign_match_state', 'AUTO_ATTACHED', 'matching_rule', 'POSTGIS_RADIUS')
         ELSE jsonb_build_object('campaign_candidate_ids', r.campaign_candidate_ids, 'matching_rule', 'POSTGIS_RADIUS')
       END,
       r.received_at + interval '1 minute'
  FROM assistance_request r
 WHERE (r.tracking_code LIKE 'C48CAM%' OR r.tracking_code LIKE 'C48DEM%') AND r.campaign_match_state IN ('AUTO_ATTACHED','CONFLICT')
   AND r.campaign_match_state<>'MANUAL'
ON CONFLICT (id) DO NOTHING;

-- Campaign attribution fixtures mirror the deterministic PostGIS rule and retain audit history.
UPDATE assistance_request
   SET campaign_id='00000000-0000-4000-8000-0000000000c3',campaign_match_state='AUTO_ATTACHED',
       campaign_candidate_ids=NULL,version=version+1
 WHERE id='00000000-0000-4000-8000-0000000000f1'
   AND (campaign_id IS DISTINCT FROM '00000000-0000-4000-8000-0000000000c3'::uuid OR campaign_match_state<>'AUTO_ATTACHED');

UPDATE assistance_request
   SET campaign_id=NULL,campaign_match_state='CONFLICT',
       campaign_candidate_ids=ARRAY['00000000-0000-4000-8000-0000000000c1'::uuid,'00000000-0000-4000-8000-0000000000c2'::uuid],
       version=version+1
 WHERE id='00000000-0000-4000-8000-00000000f103'
   AND (campaign_id IS NOT NULL OR campaign_match_state<>'CONFLICT'
        OR campaign_candidate_ids IS DISTINCT FROM ARRAY['00000000-0000-4000-8000-0000000000c1'::uuid,'00000000-0000-4000-8000-0000000000c2'::uuid]);

UPDATE assistance_request
   SET campaign_match_state='MANUAL',campaign_candidate_ids=NULL
 WHERE campaign_id IS NOT NULL AND id<>'00000000-0000-4000-8000-0000000000f1'
   AND tracking_code NOT LIKE 'C48CAM%'
   AND campaign_match_state NOT IN ('MANUAL','AUTO_ATTACHED');

UPDATE assistance_request
   SET campaign_match_state='UNMATCHED',campaign_candidate_ids=NULL
 WHERE campaign_id IS NULL AND campaign_match_state<>'CONFLICT'
   AND (campaign_match_state<>'UNMATCHED' OR campaign_candidate_ids IS NOT NULL);

-- Primary coordinator claim examples: one live claim and one retained but expired claim.
UPDATE assistance_request
   SET handled_by='00000000-0000-4000-8000-000000000102',handled_at=now()-interval '5 minutes'
 WHERE id='00000000-0000-4000-8000-00000000f102'
   AND (handled_by IS DISTINCT FROM '00000000-0000-4000-8000-000000000102'::uuid OR handled_at<=now()-interval '15 minutes');
UPDATE assistance_request
   SET handled_by='00000000-0000-4000-8000-000000000102',handled_at=now()-interval '20 minutes'
 WHERE id='00000000-0000-4000-8000-00000000f106'
   AND handled_by IS DISTINCT FROM '00000000-0000-4000-8000-000000000102'::uuid;
INSERT INTO request_event (id,request_id,actor_user_id,event_type,visibility,from_status,to_status,payload,occurred_at)
SELECT fixture.event_id,request.id,'00000000-0000-4000-8000-000000000102','CLAIMED','STAFF',request.status,request.status,
       jsonb_build_object('handled_at',request.handled_at,'seed_fixture',true),request.handled_at
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000e1210'::uuid,'00000000-0000-4000-8000-00000000f102'::uuid),
    ('00000000-0000-4000-8000-0000000e1211'::uuid,'00000000-0000-4000-8000-00000000f106'::uuid)
  ) AS fixture(event_id,request_id)
  JOIN assistance_request request ON request.id=fixture.request_id AND request.handled_by='00000000-0000-4000-8000-000000000102'
ON CONFLICT (id) DO NOTHING;

WITH changed AS (
  UPDATE assistance_request SET status='TRIAGED',priority='P1',priority_basis='COMPLETE',version=version+1
   WHERE id='00000000-0000-4000-8000-00000000f107'
     AND (status<>'TRIAGED' OR priority IS DISTINCT FROM 'P1' OR priority_basis IS DISTINCT FROM 'COMPLETE')
   RETURNING id,version
)
INSERT INTO request_event (id,request_id,actor_user_id,event_type,visibility,from_status,to_status,payload,occurred_at)
SELECT md5('c48-seed-priority:'||changed.id::text)::uuid,changed.id,'00000000-0000-4000-8000-000000000102',
       'REQUEST_TRIAGED','STAFF','SUBMITTED','TRIAGED',jsonb_build_object('priority','P1','priority_basis','COMPLETE','version',changed.version),now()-interval '55 minutes'
  FROM changed ON CONFLICT (id) DO NOTHING;

WITH attached AS (
  SELECT r.* FROM assistance_request r
   WHERE r.id='00000000-0000-4000-8000-0000000000f1' AND r.campaign_match_state='AUTO_ATTACHED'
)
INSERT INTO request_event (id,request_id,actor_user_id,event_type,visibility,from_status,to_status,payload,occurred_at)
SELECT '00000000-0000-4000-8000-0000000e1201'::uuid,a.id,NULL,'CAMPAIGN_AUTO_ATTACHED','STAFF',a.status,a.status,
       jsonb_build_object('campaign_id',a.campaign_id,'campaign_match_state','AUTO_ATTACHED','matching_rule','POSTGIS_RADIUS'),now()-interval '90 minutes'
  FROM attached a ON CONFLICT (id) DO NOTHING;

WITH conflicted AS (
  SELECT r.* FROM assistance_request r
   WHERE r.id='00000000-0000-4000-8000-00000000f103' AND r.campaign_match_state='CONFLICT'
)
INSERT INTO request_event (id,request_id,actor_user_id,event_type,visibility,from_status,to_status,payload,occurred_at)
SELECT '00000000-0000-4000-8000-0000000e1202'::uuid,r.id,NULL,'CAMPAIGN_MATCH_CONFLICT','STAFF',r.status,r.status,
       jsonb_build_object('campaign_candidate_ids',r.campaign_candidate_ids,'matching_rule','POSTGIS_RADIUS'),now()-interval '140 minutes'
  FROM conflicted r ON CONFLICT (id) DO NOTHING;

INSERT INTO request_event (id,request_id,actor_user_id,event_type,visibility,from_status,to_status,payload,occurred_at)
SELECT md5('c48-seed-manual-campaign:'||r.id::text)::uuid,r.id,NULL,'CAMPAIGN_ATTACHED','STAFF',r.status,r.status,
       jsonb_build_object('campaign_id',r.campaign_id,'campaign_match_state','MANUAL','seed_fixture',true),r.received_at
  FROM assistance_request r
 WHERE r.campaign_id IS NOT NULL AND r.campaign_match_state='MANUAL'
   AND NOT EXISTS (SELECT 1 FROM request_event e WHERE e.request_id=r.id AND e.event_type IN ('CAMPAIGN_ATTACHED','CAMPAIGN_AUTO_ATTACHED'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
SELECT NULL,'CAMPAIGN_AUTO_ATTACHED','assistance_request',r.id::text,
       jsonb_build_object('campaign_id',NULL,'campaign_match_state','UNMATCHED'),
       jsonb_build_object('campaign_id',r.campaign_id,'campaign_match_state','AUTO_ATTACHED'),'SEED_AUTO_ATTRIBUTION'
  FROM assistance_request r
 WHERE r.id='00000000-0000-4000-8000-0000000000f1'
   AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id=r.id::text AND a.action='CAMPAIGN_AUTO_ATTACHED' AND a.reason='SEED_AUTO_ATTRIBUTION');

INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
SELECT NULL,'CAMPAIGN_MATCH_CONFLICT','assistance_request',r.id::text,
       jsonb_build_object('campaign_id','00000000-0000-4000-8000-0000000000c5','campaign_match_state','MANUAL'),
       jsonb_build_object('campaign_id',NULL,'campaign_match_state','CONFLICT','campaign_candidate_ids',r.campaign_candidate_ids),'SEED_CONFLICT_ATTRIBUTION'
  FROM assistance_request r
 WHERE r.id='00000000-0000-4000-8000-00000000f103'
   AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id=r.id::text AND a.action='CAMPAIGN_MATCH_CONFLICT' AND a.reason='SEED_CONFLICT_ATTRIBUTION');

INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
SELECT NULL,'CAMPAIGN_ATTACHED','assistance_request',r.id::text,
       jsonb_build_object('campaign_id',NULL,'campaign_match_state','UNMATCHED'),
       jsonb_build_object('campaign_id',r.campaign_id,'campaign_match_state','MANUAL'),'SEED_MANUAL_ATTRIBUTION'
  FROM assistance_request r
 WHERE r.campaign_id IS NOT NULL AND r.campaign_match_state='MANUAL'
   AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id=r.id::text AND a.action='CAMPAIGN_ATTACHED' AND a.reason='SEED_MANUAL_ATTRIBUTION');

INSERT INTO notice (source_id,source_version,recipient_user_id,notice_type,payload)
SELECT r.id,r.version,'00000000-0000-4000-8000-000000000102','CAMPAIGN_MATCH_CONFLICT',
       jsonb_build_object('text_code','CAMPAIGN_MATCH_CONFLICT','request_id',r.id::text,
         'message',format('SOS %s nằm trong vùng của nhiều chiến dịch (%s, %s). Cần điều phối chính chọn chiến dịch.',r.tracking_code,c1.name,c2.name),
         'campaign_ids',jsonb_build_array(c1.id,c2.id))
  FROM assistance_request r
  JOIN campaign c1 ON c1.id='00000000-0000-4000-8000-0000000000c1'
  JOIN campaign c2 ON c2.id='00000000-0000-4000-8000-0000000000c2'
 WHERE r.id='00000000-0000-4000-8000-00000000f103' AND r.campaign_match_state='CONFLICT'
ON CONFLICT (source_id,source_version,recipient_user_id,notice_type) DO NOTHING;

INSERT INTO campaign_engagement (id,campaign_id,user_id,started_at,last_active_at,ended_at,ended_reason) VALUES
  ('00000000-0000-4000-8000-00000000e201'::uuid,'00000000-0000-4000-8000-0000000000c1'::uuid,'00000000-0000-4000-8000-000000000103'::uuid,now()-interval '50 minutes',now()-interval '5 minutes',NULL,NULL),
  ('00000000-0000-4000-8000-00000000e202'::uuid,'00000000-0000-4000-8000-0000000000c3'::uuid,'00000000-0000-4000-8000-000000000118'::uuid,now()-interval '25 minutes',now()-interval '20 minutes',now()-interval '15 minutes','LEFT'),
  ('00000000-0000-4000-8000-00000000e203'::uuid,'00000000-0000-4000-8000-0000000000c4'::uuid,'00000000-0000-4000-8000-000000000103'::uuid,now()-interval '8 hours',now()-interval '7 hours',now()-interval '6 hours','LEFT'),
  ('00000000-0000-4000-8000-00000000e204'::uuid,'00000000-0000-4000-8000-0000000000c7'::uuid,'00000000-0000-4000-8000-000000000118'::uuid,now()-interval '3 hours',now()-interval '2 hours',now()-interval '1 hour','EXPIRED')
ON CONFLICT DO NOTHING;
