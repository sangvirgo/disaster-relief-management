-- Additive nationwide SOS fixture for the primary c48_response database.
-- These are plausible synthetic reports at approximate locality pins, not real incidents.
-- No campaign is created or attached. Points inside any active campaign area are skipped.
-- Run with psql -v ON_ERROR_STOP=1; existing requests are never changed or removed.
BEGIN;

SELECT pg_advisory_xact_lock(48352026, 17);

-- Preserve deterministic IDs that are already valid and repair MD5 UUIDs whose
-- version/variant bits are rejected by the request API.
CREATE FUNCTION pg_temp.c48_standalone_uuid(value text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  WITH digest AS (SELECT md5(value) AS hex)
  SELECT CASE WHEN hex::uuid::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN hex::uuid
    ELSE overlay(overlay(hex placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid
  END FROM digest;
$$;

CREATE TEMP TABLE standalone_hub (
  seq int PRIMARY KEY, locality text NOT NULL, longitude float8 NOT NULL,
  latitude float8 NOT NULL, terrain text NOT NULL
) ON COMMIT DROP;

INSERT INTO standalone_hub VALUES
  (1, 'Cao Bằng', 106.258, 22.667, 'MOUNTAIN'),
  (2, 'Bắc Kạn', 105.834, 22.147, 'MOUNTAIN'),
  (3, 'Tuyên Quang', 105.214, 21.823, 'MOUNTAIN'),
  (4, 'Yên Bái', 104.872, 21.716, 'MOUNTAIN'),
  (5, 'Sơn La', 103.905, 21.326, 'MOUNTAIN'),
  (6, 'Điện Biên Phủ', 103.020, 21.386, 'MOUNTAIN'),
  (7, 'Lai Châu', 103.458, 22.397, 'MOUNTAIN'),
  (8, 'Hòa Bình', 105.338, 20.817, 'MOUNTAIN'),
  (9, 'Việt Trì', 105.405, 21.322, 'PLAIN'),
  (10, 'Thái Nguyên', 105.844, 21.593, 'URBAN'),
  (11, 'Bắc Giang', 106.194, 21.273, 'URBAN'),
  (12, 'Lạng Sơn', 106.761, 21.852, 'MOUNTAIN'),
  (13, 'Móng Cái', 107.973, 21.524, 'COAST'),
  (14, 'Hạ Long', 107.082, 20.956, 'COAST'),
  (15, 'Nam Định', 106.162, 20.438, 'PLAIN'),
  (16, 'Ninh Bình', 105.974, 20.253, 'PLAIN'),
  (17, 'Thái Bình', 106.338, 20.446, 'PLAIN'),
  (18, 'Mù Cang Chải', 104.091, 21.850, 'MOUNTAIN'),
  (19, 'Bắc Hà', 104.294, 22.535, 'MOUNTAIN'),
  (20, 'Đồng Văn', 105.365, 23.281, 'MOUNTAIN'),
  (21, 'Pác Bó', 106.060, 22.970, 'MOUNTAIN'),
  (22, 'Bản Giốc', 106.720, 22.853, 'MOUNTAIN'),
  (23, 'Phủ Lý', 105.914, 20.542, 'PLAIN'),
  (24, 'Vĩnh Yên', 105.597, 21.309, 'URBAN'),
  (25, 'Vinh', 105.691, 18.673, 'URBAN'),
  (26, 'Cửa Lò', 105.720, 18.800, 'COAST'),
  (27, 'Hà Tĩnh', 105.906, 18.343, 'PLAIN'),
  (28, 'Hương Khê', 105.692, 17.650, 'MOUNTAIN'),
  (29, 'Đồng Hới', 106.623, 17.469, 'COAST'),
  (30, 'Khe Sanh', 106.721, 16.634, 'MOUNTAIN'),
  (31, 'Đông Hà', 107.100, 16.816, 'PLAIN'),
  (32, 'A Lưới', 107.280, 16.225, 'MOUNTAIN'),
  (33, 'Tam Kỳ', 108.480, 15.573, 'PLAIN'),
  (34, 'Quảng Ngãi', 108.793, 15.121, 'PLAIN'),
  (35, 'Kon Tum', 108.000, 14.355, 'MOUNTAIN'),
  (36, 'Pleiku', 108.006, 13.979, 'MOUNTAIN'),
  (37, 'Ngọc Hồi', 107.640, 14.710, 'MOUNTAIN'),
  (38, 'Măng Đen', 108.262, 14.610, 'MOUNTAIN'),
  (39, 'Tuy Hòa', 109.300, 13.095, 'COAST'),
  (40, 'Buôn Ma Thuột', 108.045, 12.668, 'URBAN'),
  (41, 'Ea H''leo', 108.200, 13.230, 'MOUNTAIN'),
  (42, 'Nha Trang', 109.192, 12.243, 'COAST'),
  (43, 'Cam Ranh', 109.159, 11.921, 'COAST'),
  (44, 'Phan Rang', 108.988, 11.565, 'COAST'),
  (45, 'Phan Thiết', 108.102, 10.932, 'COAST'),
  (46, 'Gia Nghĩa', 107.690, 11.995, 'MOUNTAIN'),
  (47, 'Bảo Lộc', 107.807, 11.548, 'MOUNTAIN'),
  (48, 'Krông Ana', 108.000, 12.480, 'MOUNTAIN'),
  (49, 'Ninh Hòa', 109.100, 12.490, 'COAST'),
  (50, 'Biên Hòa', 106.824, 10.957, 'URBAN'),
  (51, 'Tây Ninh', 106.102, 11.310, 'PLAIN'),
  (52, 'Vũng Tàu', 107.084, 10.346, 'COAST'),
  (53, 'Bà Rịa', 107.167, 10.497, 'PLAIN'),
  (54, 'Long Xuyên', 105.435, 10.386, 'DELTA'),
  (55, 'Châu Đốc', 105.116, 10.705, 'DELTA'),
  (56, 'Rạch Giá', 105.080, 10.012, 'COAST'),
  (57, 'Hà Tiên', 104.487, 10.383, 'COAST'),
  (58, 'Bạc Liêu', 105.726, 9.285, 'DELTA'),
  (59, 'Sóc Trăng', 105.973, 9.603, 'DELTA'),
  (60, 'Bến Tre', 106.375, 10.241, 'DELTA'),
  (61, 'Mỹ Tho', 106.359, 10.361, 'DELTA'),
  (62, 'Cao Lãnh', 105.636, 10.460, 'DELTA'),
  (63, 'Tân An', 106.408, 10.536, 'DELTA'),
  (64, 'Trà Vinh', 106.347, 9.934, 'DELTA'),
  (65, 'Mộc Hóa', 105.940, 10.760, 'DELTA'),
  (66, 'Đồng Xoài', 106.891, 11.535, 'PLAIN'),
  (67, 'Bình Long', 106.608, 11.649, 'PLAIN'),
  (68, 'Gò Công', 106.675, 10.364, 'DELTA'),
  (69, 'Sa Đéc', 105.764, 10.293, 'DELTA'),
  (70, 'Cái Bè', 105.946, 10.340, 'DELTA');

CREATE TEMP TABLE standalone_sos_fixture ON COMMIT DROP AS
WITH candidates AS (
  SELECT h.seq, h.locality, h.terrain, n.slot,
         (h.seq - 1) * 4 + n.slot AS ordinal,
         CASE h.terrain
           WHEN 'MOUNTAIN' THEN (ARRAY['LANDSLIDE','TRAPPED','MEDICAL','SUPPLY_SHORTAGE'])[n.slot]
           WHEN 'COAST' THEN (ARRAY['STORM','FLOOD','MEDICAL','SUPPLY_SHORTAGE'])[n.slot]
           WHEN 'DELTA' THEN (ARRAY['FLOOD','TRAPPED','MEDICAL','SUPPLY_SHORTAGE'])[n.slot]
           WHEN 'URBAN' THEN (ARRAY['FIRE','MEDICAL','STORM','OTHER'])[n.slot]
           ELSE (ARRAY['FLOOD','STORM','MEDICAL','SUPPLY_SHORTAGE'])[n.slot]
         END AS category_code,
         h.longitude + CASE WHEN h.terrain='COAST' THEN
           (ARRAY[-0.035,-0.065,-0.095,-0.020])[n.slot]
           ELSE (ARRAY[-0.045,0.055,-0.075,0.025])[n.slot] END AS longitude,
         h.latitude + (ARRAY[0.055,-0.045,-0.065,0.085])[n.slot] AS latitude
    FROM standalone_hub h CROSS JOIN generate_series(1, 4) AS n(slot)
)
SELECT c.*, pg_temp.c48_standalone_uuid('c48-standalone-request-' || c.ordinal) AS request_id,
       'C48X' || lpad(c.ordinal::text, 6, '0') AS tracking_code
  FROM candidates c
 WHERE NOT EXISTS (
   SELECT 1 FROM campaign campaign
    WHERE campaign.status='ACTIVE' AND campaign.center IS NOT NULL
      AND ST_DWithin(campaign.center,
          ST_SetSRID(ST_MakePoint(c.longitude,c.latitude),4326)::geography,
          campaign.radius_m)
 );

-- Correct fixed coastal/border pins after checking them against geoBoundaries
-- VNM ADM0 (2016). Hương Khê's original hub was entered too far south.
UPDATE standalone_sos_fixture s SET longitude=f.longitude, latitude=f.latitude
  FROM (VALUES
    (49,107.93104::float8,21.57639::float8),
    (51,107.87621::float8,21.46907::float8),
    (52,107.92087::float8,21.58743::float8),
    (54,106.98332::float8,20.93169::float8),
    (55,106.97487::float8,20.85475::float8),
    (80,105.35472::float8,23.34466::float8),
    (81,106.02020::float8,22.99082::float8),
    (84,106.07958::float8,22.99260::float8),
    (85,106.67500::float8,22.88967::float8),
    (88,106.70593::float8,22.88317::float8),
    (104,105.68938::float8,18.87773::float8),
    (109,105.68000::float8,18.19600::float8),
    (110,105.72000::float8,18.16000::float8),
    (111,105.68500::float8,18.14500::float8),
    (112,105.71500::float8,18.20500::float8),
    (116,106.58538::float8,17.54597::float8),
    (119,106.66235::float8,16.57870::float8),
    (205,107.06942::float8,10.37529::float8),
    (206,107.08395::float8,10.33769::float8),
    (207,107.09500::float8,10.35000::float8),
    (208,107.07006::float8,10.44568::float8),
    (211,107.09190::float8,10.43913::float8),
    (217,105.08090::float8,10.76508::float8),
    (222,105.03566::float8,9.93060::float8),
    (223,105.01146::float8,9.90867::float8),
    (225,104.45294::float8,10.42062::float8),
    (226,104.44270::float8,10.37966::float8),
    (227,104.33848::float8,10.29942::float8),
    (228,104.47233::float8,10.42374::float8)
  ) f(ordinal,longitude,latitude)
 WHERE s.ordinal=f.ordinal;

DO $$ BEGIN
  IF (SELECT count(*) FROM standalone_sos_fixture) < 200 THEN
    RAISE EXCEPTION 'Fewer than 200 standalone SOS points remain after campaign exclusion';
  END IF;
  IF EXISTS (SELECT 1 FROM standalone_sos_fixture s
             LEFT JOIN incident_category i ON i.code=s.category_code WHERE i.code IS NULL) THEN
    RAISE EXCEPTION 'Missing incident category';
  END IF;
END $$;

INSERT INTO assistance_request (
  id, tracking_code, incident_category_code, campaign_match_state, report_mode,
  reporter_name, description, status, verifying_since, needs_rescue,
  needs_relief_supplies, reporter_declared_danger, received_at
)
SELECT s.request_id, s.tracking_code, s.category_code, 'UNMATCHED', 'SELF',
       'Người báo mô phỏng ' || lpad(s.ordinal::text, 3, '0'),
       CASE s.category_code
         WHEN 'FLOOD' THEN 'Nước dâng quanh lối đi; cần xác minh mức ngập và đường tiếp cận.'
         WHEN 'LANDSLIDE' THEN 'Đất đá có dấu hiệu sạt xuống gần khu dân cư; cần kiểm tra hiện trường.'
         WHEN 'STORM' THEN 'Gió mạnh làm hư hỏng mái che và cản trở di chuyển.'
         WHEN 'FIRE' THEN 'Có khói và nguy cơ cháy lan; cần xác minh nguồn cháy.'
         WHEN 'MEDICAL' THEN 'Một người cần hỗ trợ sơ cứu và đánh giá tình trạng sức khỏe.'
         WHEN 'TRAPPED' THEN 'Có người chưa thể rời khỏi vị trí an toàn; cần hỗ trợ tiếp cận.'
         WHEN 'SUPPLY_SHORTAGE' THEN 'Các hộ gần đây cần nước uống và nhu yếu phẩm thiết yếu.'
         ELSE 'Người dân đề nghị điều phối viên liên hệ để làm rõ nhu cầu hỗ trợ.'
       END || ' Báo cáo mô phỏng gần ' || s.locality || '.',
       CASE WHEN s.ordinal % 7 = 0 THEN 'VERIFYING' ELSE 'SUBMITTED' END::request_status,
       CASE WHEN s.ordinal % 7 = 0 THEN now() - ((s.ordinal * 19) % 5500 + 2) * interval '1 minute' END,
       s.category_code <> 'SUPPLY_SHORTAGE',
       s.category_code IN ('FLOOD','STORM','TRAPPED','SUPPLY_SHORTAGE'),
       s.category_code IN ('FIRE','TRAPPED') AND s.ordinal % 5 = 0,
       now() - ((s.ordinal * 19) % 5500 + 20) * interval '1 minute'
  FROM standalone_sos_fixture s
ON CONFLICT (id) DO NOTHING;

INSERT INTO request_subject (request_id, people_affected, children_count, elderly_count,
                             location, location_source, household_reference_note)
SELECT s.request_id, 1 + s.ordinal % 7,
       CASE WHEN s.ordinal % 8 = 0 THEN 1 ELSE 0 END,
       CASE WHEN s.ordinal % 11 = 0 THEN 1 ELSE 0 END,
       ST_SetSRID(ST_MakePoint(s.longitude,s.latitude),4326)::geography,
       'MANUAL_PIN', 'Tọa độ mô phỏng gần ' || s.locality
  FROM standalone_sos_fixture s
  JOIN assistance_request r ON r.id=s.request_id AND r.tracking_code=s.tracking_code
ON CONFLICT (request_id) DO NOTHING;

INSERT INTO request_event (id, request_id, event_type, visibility, from_status,
                           to_status, payload, occurred_at)
SELECT pg_temp.c48_standalone_uuid('c48-standalone-submitted-' || s.ordinal), r.id,
       'REQUEST_SUBMITTED', 'REPORTER', NULL, 'SUBMITTED',
       jsonb_build_object('public_text_code','RECEIVED','seed_fixture',true), r.received_at
  FROM standalone_sos_fixture s
  JOIN assistance_request r ON r.id=s.request_id AND r.tracking_code=s.tracking_code
ON CONFLICT (id) DO NOTHING;

INSERT INTO request_event (id, request_id, actor_user_id, event_type, visibility,
                           from_status, to_status, payload, occurred_at)
SELECT pg_temp.c48_standalone_uuid('c48-standalone-verifying-' || s.ordinal), r.id,
       '00000000-0000-4000-8000-000000000102'::uuid,
       'VERIFICATION_STARTED', 'REPORTER', 'SUBMITTED', 'VERIFYING',
       jsonb_build_object('public_text_code','VERIFYING','seed_fixture',true), r.verifying_since
  FROM standalone_sos_fixture s
  JOIN assistance_request r ON r.id=s.request_id AND r.tracking_code=s.tracking_code
 WHERE r.status='VERIFYING' AND r.verifying_since IS NOT NULL
ON CONFLICT (id) DO NOTHING;

COMMIT;
