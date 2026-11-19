-- Additive, repeatable nationwide map fixture for the primary c48_response database.
-- Synthetic demo records only. Run with psql -v ON_ERROR_STOP=1; never reset existing data.
-- Four campaign themes (rescue, evacuation, medical, supplies) occur once per region.
-- Central fixtures are intentionally light so a later flood-focused import can stand out.
BEGIN;

SELECT pg_advisory_xact_lock(48352026, 16);

-- Keep already-valid deterministic IDs stable while correcting MD5 UUIDs whose
-- version/variant bits fail the API's UUID parser.
CREATE FUNCTION pg_temp.c48_nationwide_uuid(value text) RETURNS uuid
LANGUAGE sql IMMUTABLE AS $$
  WITH digest AS (SELECT md5(value) AS hex)
  SELECT CASE WHEN hex::uuid::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN hex::uuid
    ELSE overlay(overlay(hex placing '4' from 13 for 1) placing '8' from 17 for 1)::uuid
  END FROM digest;
$$;

CREATE TEMP TABLE nationwide_campaign_fixture (
  seq int PRIMARY KEY, name text NOT NULL, objective text NOT NULL,
  longitude float8 NOT NULL, latitude float8 NOT NULL, radius_m int NOT NULL,
  categories text[] NOT NULL
) ON COMMIT DROP;

INSERT INTO nationwide_campaign_fixture VALUES
  (1, 'Cứu hộ địa hình Hà Giang', 'Tiếp nhận SOS và điều phối cứu hộ tại khu vực miền núi phía Bắc.', 104.984, 22.824, 32000, ARRAY['LANDSLIDE','TRAPPED','MEDICAL','STORM']),
  (2, 'Hỗ trợ y tế Hà Nội', 'Kết nối yêu cầu sơ cứu và hỗ trợ y tế cộng đồng.', 105.851, 21.028, 30000, ARRAY['MEDICAL','FIRE','TRAPPED','OTHER']),
  (3, 'Sơ tán an toàn Hải Phòng', 'Hỗ trợ sơ tán và theo dõi nhu cầu tại khu vực ven biển.', 106.683, 20.861, 30000, ARRAY['STORM','FLOOD','TRAPPED','SUPPLY_SHORTAGE']),
  (4, 'Tiếp tế thiết yếu Lào Cai', 'Ghi nhận nhu cầu nước sạch, thực phẩm và vật tư thiết yếu.', 103.975, 22.481, 32000, ARRAY['SUPPLY_SHORTAGE','LANDSLIDE','STORM','MEDICAL']),
  (5, 'Sơ tán cộng đồng Thanh Hóa', 'Theo dõi điểm cần hỗ trợ di chuyển và nơi trú tạm.', 105.776, 19.807, 32000, ARRAY['FLOOD','STORM','TRAPPED','SUPPLY_SHORTAGE']),
  (6, 'Tiếp tế dân sinh Huế', 'Tổng hợp nhu cầu hàng cứu trợ và nước sạch tại địa phương.', 107.590, 16.463, 30000, ARRAY['SUPPLY_SHORTAGE','FLOOD','MEDICAL','OTHER']),
  (7, 'Cứu hộ cơ động Đà Nẵng', 'Điều phối tiếp nhận và xác minh yêu cầu cứu hộ.', 108.202, 16.055, 28000, ARRAY['TRAPPED','STORM','MEDICAL','FIRE']),
  (8, 'Hỗ trợ y tế Quy Nhơn', 'Hỗ trợ sơ cứu và tiếp nhận nhu cầu y tế khẩn cấp.', 109.220, 13.783, 28000, ARRAY['MEDICAL','STORM','FLOOD','SUPPLY_SHORTAGE']),
  (9, 'Hỗ trợ y tế Đà Lạt', 'Theo dõi trường hợp cần hỗ trợ y tế tại khu vực cao nguyên.', 108.438, 11.940, 30000, ARRAY['MEDICAL','LANDSLIDE','FIRE','OTHER']),
  (10, 'Tiếp tế cộng đồng TP. Hồ Chí Minh', 'Tiếp nhận nhu cầu nhu yếu phẩm và hỗ trợ cộng đồng.', 106.700, 10.776, 30000, ARRAY['SUPPLY_SHORTAGE','FIRE','MEDICAL','STORM']),
  (11, 'Cứu hộ đường thủy Cần Thơ', 'Tiếp nhận SOS và phối hợp hỗ trợ tại khu vực sông nước.', 105.785, 10.045, 30000, ARRAY['FLOOD','TRAPPED','MEDICAL','SUPPLY_SHORTAGE']),
  (12, 'Sơ tán ven biển Cà Mau', 'Theo dõi nhu cầu di chuyển an toàn và hỗ trợ thiết yếu.', 105.152, 9.177, 30000, ARRAY['STORM','FLOOD','TRAPPED','SUPPLY_SHORTAGE']);

DO $$ BEGIN
  IF (SELECT count(*) FROM incident_category WHERE code IN
    ('FLOOD','LANDSLIDE','STORM','FIRE','MEDICAL','TRAPPED','SUPPLY_SHORTAGE','OTHER')) <> 8 THEN
    RAISE EXCEPTION 'Missing incident categories; run the main Response catalog seed first';
  END IF;
END $$;

INSERT INTO campaign (id, name, objective, status, starts_at, ends_at,
                      created_by_user_id, created_at, center, radius_m)
SELECT pg_temp.c48_nationwide_uuid('c48-nationwide-campaign-' || f.seq), f.name, f.objective,
       'ACTIVE', now() - interval '2 days', now() + interval '30 days',
       '00000000-0000-4000-8000-000000000102'::uuid, now() - interval '2 days',
       ST_SetSRID(ST_MakePoint(f.longitude, f.latitude), 4326)::geography, f.radius_m
  FROM nationwide_campaign_fixture f
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
  IF (SELECT count(*) FROM nationwide_campaign_fixture f JOIN campaign c
        ON c.id = pg_temp.c48_nationwide_uuid('c48-nationwide-campaign-' || f.seq)
       AND c.name = f.name AND c.status = 'ACTIVE') <> 12 THEN
    RAISE EXCEPTION 'Nationwide campaign IDs conflict with existing data';
  END IF;
END $$;

CREATE TEMP TABLE nationwide_sos_fixture ON COMMIT DROP AS
SELECT f.seq, n.slot, (f.seq - 1) * 4 + n.slot AS ordinal,
       pg_temp.c48_nationwide_uuid('c48-nationwide-request-' || f.seq || '-' || n.slot) AS request_id,
       pg_temp.c48_nationwide_uuid('c48-nationwide-campaign-' || f.seq) AS campaign_id,
       'C48VN' || lpad(((f.seq - 1) * 4 + n.slot)::text, 5, '0') AS tracking_code,
       f.categories[n.slot] AS category_code,
       CASE n.slot WHEN 1 THEN f.longitude - 0.055
                   WHEN 2 THEN f.longitude - 0.095
                   WHEN 3 THEN f.longitude + 0.025
                   ELSE f.longitude - 0.025 END AS longitude,
       CASE n.slot WHEN 1 THEN f.latitude + 0.045
                   WHEN 2 THEN f.latitude - 0.055
                   WHEN 3 THEN f.latitude - 0.045
                   ELSE f.latitude + 0.085 END AS latitude,
       f.name AS campaign_name
  FROM nationwide_campaign_fixture f CROSS JOIN generate_series(1, 4) AS n(slot);

-- Correct three generated coastal/border pins using geoBoundaries VNM ADM0 (2016).
UPDATE nationwide_sos_fixture s SET longitude=f.longitude, latitude=f.latitude
  FROM (VALUES
    (16,103.92964::float8,22.52871::float8),
    (28,108.13955::float8,16.16018::float8),
    (31,109.21885::float8,13.74053::float8)
  ) f(ordinal,longitude,latitude)
 WHERE s.ordinal=f.ordinal;

DO $$ BEGIN
  IF (SELECT count(*) FROM nationwide_sos_fixture s JOIN campaign c ON c.id=s.campaign_id
      WHERE ST_DWithin(c.center, ST_SetSRID(ST_MakePoint(s.longitude,s.latitude),4326)::geography, c.radius_m)) <> 48 THEN
    RAISE EXCEPTION 'A nationwide SOS lies outside its campaign area';
  END IF;
END $$;

INSERT INTO assistance_request (
  id, tracking_code, campaign_id, campaign_match_state, incident_category_code,
  report_mode, reporter_name, reporter_contact_phone, description, status,
  verifying_since, needs_rescue, needs_relief_supplies, reporter_declared_danger, received_at
)
SELECT s.request_id, s.tracking_code, s.campaign_id, 'AUTO_ATTACHED', s.category_code,
       'SELF', 'Người báo mô phỏng ' || lpad(s.ordinal::text, 2, '0'),
       '090000' || lpad(s.ordinal::text, 4, '0'),
       CASE s.category_code
         WHEN 'FLOOD' THEN 'Nước dâng quanh khu dân cư; cần xác minh khả năng di chuyển.'
         WHEN 'LANDSLIDE' THEN 'Đất đá tràn gần lối đi; cần kiểm tra mức độ an toàn.'
         WHEN 'STORM' THEN 'Gió mạnh làm hư hỏng mái che; cần hỗ trợ kiểm tra hiện trường.'
         WHEN 'FIRE' THEN 'Phát hiện khói và nguy cơ cháy lan; cần xác minh nhanh.'
         WHEN 'MEDICAL' THEN 'Có người cần hỗ trợ sơ cứu và đánh giá tình trạng sức khỏe.'
         WHEN 'TRAPPED' THEN 'Có người chưa thể rời khỏi khu vực; cần hỗ trợ tiếp cận.'
         WHEN 'SUPPLY_SHORTAGE' THEN 'Một số hộ thiếu nước uống và nhu yếu phẩm thiết yếu.'
         ELSE 'Người dân cần điều phối viên liên hệ để xác minh tình huống.'
       END || ' Dữ liệu mô phỏng tại ' || s.campaign_name || '.',
       CASE WHEN s.slot = 3 THEN 'VERIFYING' ELSE 'SUBMITTED' END::request_status,
       CASE WHEN s.slot = 3 THEN now() - (s.ordinal + 10) * interval '1 minute' END,
       s.category_code <> 'SUPPLY_SHORTAGE',
       s.category_code IN ('FLOOD','STORM','SUPPLY_SHORTAGE','TRAPPED'),
       s.category_code IN ('FIRE','TRAPPED') AND s.slot = 1,
       now() - (s.ordinal * 7 + 20) * interval '1 minute'
  FROM nationwide_sos_fixture s
ON CONFLICT (id) DO NOTHING;

INSERT INTO request_subject (request_id, people_affected, children_count, elderly_count,
                             location, location_source)
SELECT s.request_id, 1 + s.slot + s.seq % 4,
       CASE WHEN s.slot = 2 THEN 1 ELSE 0 END,
       CASE WHEN s.slot = 4 THEN 1 ELSE 0 END,
       ST_SetSRID(ST_MakePoint(s.longitude,s.latitude),4326)::geography, 'MANUAL_PIN'
  FROM nationwide_sos_fixture s
  JOIN assistance_request r ON r.id=s.request_id AND r.tracking_code=s.tracking_code
ON CONFLICT (request_id) DO NOTHING;

INSERT INTO request_event (id, request_id, event_type, visibility, from_status,
                           to_status, payload, occurred_at)
SELECT pg_temp.c48_nationwide_uuid('c48-nationwide-submitted-' || s.ordinal), r.id,
       'REQUEST_SUBMITTED', 'REPORTER', NULL, 'SUBMITTED',
       jsonb_build_object('public_text_code','RECEIVED','seed_fixture',true), r.received_at
  FROM nationwide_sos_fixture s
  JOIN assistance_request r ON r.id=s.request_id AND r.tracking_code=s.tracking_code
ON CONFLICT (id) DO NOTHING;

INSERT INTO request_event (id, request_id, actor_user_id, event_type, visibility,
                           from_status, to_status, payload, occurred_at)
SELECT pg_temp.c48_nationwide_uuid('c48-nationwide-verifying-' || s.ordinal), r.id,
       '00000000-0000-4000-8000-000000000102'::uuid,
       'VERIFICATION_STARTED', 'REPORTER', 'SUBMITTED', 'VERIFYING',
       jsonb_build_object('public_text_code','VERIFYING','seed_fixture',true), r.verifying_since
  FROM nationwide_sos_fixture s
  JOIN assistance_request r ON r.id=s.request_id AND r.tracking_code=s.tracking_code
 WHERE s.slot=3 AND r.status='VERIFYING'
ON CONFLICT (id) DO NOTHING;

COMMIT;
