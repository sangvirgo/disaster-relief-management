-- Additive synthetic Logistics fixtures. Safe to apply more than once.
INSERT INTO unit (code, display_name, scale) VALUES
  ('CAI', 'cái', 0), ('CHAI', 'chai', 0), ('GOI', 'gói', 0), ('KG', 'kg', 3), ('THUNG', 'thùng', 0)
ON CONFLICT DO NOTHING;
INSERT INTO item_type (code, display_name) VALUES
  ('LUONG_THUC', 'Lương thực'), ('NUOC_UONG', 'Nước uống'), ('Y_TE', 'Vật tư y tế'), ('CHAN_MEN', 'Chăn màn, nơi trú ẩn')
ON CONFLICT DO NOTHING;

INSERT INTO item (id, item_type_code, unit_code, name, returnable, aliases)
SELECT fixture.id, fixture.item_type_code, fixture.unit_code, fixture.name, fixture.returnable, fixture.aliases
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000a1010'::uuid, 'LUONG_THUC', 'KG', 'Gạo đóng túi TP. Hồ Chí Minh', 'Lương thực', 'kg', 3, false, ARRAY['gạo đóng túi']::text[]),
    ('00000000-0000-4000-8000-0000000a1011'::uuid, 'NUOC_UONG', 'CHAI', 'Nước uống đóng chai TP. Hồ Chí Minh', 'Nước uống', 'chai', 0, false, ARRAY['nước uống chai','nước suối']::text[]),
    ('00000000-0000-4000-8000-0000000a1012'::uuid, 'Y_TE', 'CAI', 'Bộ sơ cứu cộng đồng TP. Hồ Chí Minh', 'Vật tư y tế', 'cái', 0, false, ARRAY['sơ cứu cộng đồng','thuốc']::text[]),
    ('00000000-0000-4000-8000-0000000a1013'::uuid, 'CHAN_MEN', 'CAI', 'Chăn giữ nhiệt TP. Hồ Chí Minh', 'Chăn màn, nơi trú ẩn', 'cái', 0, true, ARRAY['chăn giữ nhiệt']::text[])
  ) AS fixture(id, item_type_code, unit_code, name, item_type_name, unit_name, unit_scale, returnable, aliases)
  JOIN item_type item_type ON item_type.code = fixture.item_type_code AND item_type.display_name = fixture.item_type_name
  JOIN unit unit ON unit.code = fixture.unit_code AND unit.display_name = fixture.unit_name AND unit.scale = fixture.unit_scale
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO warehouse (id, name, address_note, location, location_public, service_radius_m) VALUES
  ('00000000-0000-4000-8000-0000000a2010', 'Kho phân phối TP. Hồ Chí Minh',
   'Địa điểm giả lập phục vụ trình diễn tại TP. Hồ Chí Minh', ST_GeogFromText('SRID=4326;POINT(106.6800 10.7700)'), false, 15000)
ON CONFLICT DO NOTHING;

INSERT INTO donation_drive (id, campaign_id, campaign_status, campaign_status_at, intake_warehouse_id,
                           title, description, status, opens_at, closes_at, created_at)
SELECT fixture.id, fixture.campaign_id, 'ACTIVE', now(), warehouse.id,
       fixture.title, fixture.description, 'OPEN', now() - interval '1 day', now() + interval '12 days', now() - interval '1 day'
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000a6010'::uuid, '00000000-0000-4000-8000-0000000000c3'::uuid,
     'Quyên góp nhu yếu phẩm TP. Hồ Chí Minh',
     'Tiếp nhận lương thực, nước uống, vật tư y tế và chăn màn tại kho giả lập TP. Hồ Chí Minh.')
  ) AS fixture(id, campaign_id, title, description)
  JOIN warehouse ON warehouse.id = '00000000-0000-4000-8000-0000000a2010'
                AND warehouse.name = 'Kho phân phối TP. Hồ Chí Minh'
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO drive_item (drive_id, item_id, target_quantity, acceptance_note)
SELECT drive.id, item.id, fixture.target_quantity, fixture.acceptance_note
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000a6010'::uuid, 'Quyên góp nhu yếu phẩm TP. Hồ Chí Minh', '00000000-0000-4000-8000-0000000a1010'::uuid, 'Gạo đóng túi TP. Hồ Chí Minh', 100.000::numeric, 'Bao gói nguyên vẹn, còn hạn sử dụng'),
    ('00000000-0000-4000-8000-0000000a6010'::uuid, 'Quyên góp nhu yếu phẩm TP. Hồ Chí Minh', '00000000-0000-4000-8000-0000000a1011'::uuid, 'Nước uống đóng chai TP. Hồ Chí Minh', 240.000::numeric, 'Chai nguyên niêm phong'),
    ('00000000-0000-4000-8000-0000000a6010'::uuid, 'Quyên góp nhu yếu phẩm TP. Hồ Chí Minh', '00000000-0000-4000-8000-0000000a1012'::uuid, 'Bộ sơ cứu cộng đồng TP. Hồ Chí Minh', 40.000::numeric, 'Bộ dụng cụ còn nguyên vẹn'),
    ('00000000-0000-4000-8000-0000000a6010'::uuid, 'Quyên góp nhu yếu phẩm TP. Hồ Chí Minh', '00000000-0000-4000-8000-0000000a1013'::uuid, 'Chăn giữ nhiệt TP. Hồ Chí Minh', 60.000::numeric, NULL::text)
  ) AS fixture(drive_id, drive_title, item_id, item_name, target_quantity, acceptance_note)
  JOIN donation_drive drive ON drive.id = fixture.drive_id AND drive.title = fixture.drive_title
                           AND drive.campaign_id = '00000000-0000-4000-8000-0000000000c3'
                           AND drive.intake_warehouse_id = '00000000-0000-4000-8000-0000000a2010'
                           AND drive.campaign_status = 'ACTIVE' AND drive.status = 'OPEN'
  JOIN item ON item.id = fixture.item_id AND item.name = fixture.item_name
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO donation_delivery (id, public_code, drive_id, donor_name, donor_phone, capability_hash, status, created_at)
SELECT fixture.id, fixture.public_code, drive.id, fixture.donor_name, fixture.donor_phone,
       fixture.capability_hash, 'DECLARED', now() - fixture.age
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000a7011'::uuid, 'GD7K2N01', 'Nhà hảo tâm giả lập 11', '0900000301', '{{donation_capability_hash}}', interval '3 hours'),
    ('00000000-0000-4000-8000-0000000a7012'::uuid, 'GD7K2N02', 'Nhà hảo tâm giả lập 12', '0900000302', NULL::text, interval '2 hours'),
    ('00000000-0000-4000-8000-0000000a7013'::uuid, 'GD7K2N03', 'Nhà hảo tâm giả lập 13', '0900000303', NULL::text, interval '90 minutes'),
    ('00000000-0000-4000-8000-0000000a7014'::uuid, 'GD7K2N04', 'Nhà hảo tâm giả lập 14', '0900000304', NULL::text, interval '1 hour')
  ) AS fixture(id, public_code, donor_name, donor_phone, capability_hash, age)
  JOIN donation_drive drive ON drive.id = '00000000-0000-4000-8000-0000000a6010'
                           AND drive.title = 'Quyên góp nhu yếu phẩm TP. Hồ Chí Minh'
                           AND drive.campaign_id = '00000000-0000-4000-8000-0000000000c3'
                           AND drive.intake_warehouse_id = '00000000-0000-4000-8000-0000000a2010'
                           AND drive.campaign_status = 'ACTIVE' AND drive.status = 'OPEN'
 WHERE true
ON CONFLICT DO NOTHING;

-- Repair only the old invalid placeholder. A claimed or recovered donation has a different hash (or NULL).
UPDATE donation_delivery
   SET capability_hash='{{donation_capability_hash}}'
 WHERE id='00000000-0000-4000-8000-0000000a7011'
   AND public_code='GD7K2N01'
   AND status='DECLARED'
   AND donor_user_id IS NULL
   AND capability_hash='demo-capability-hash-seed-11';

INSERT INTO donation_declaration (delivery_id, revision, created_by_kind, created_at)
SELECT delivery.id, 1, 'DONOR', now() - fixture.age
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000a7011'::uuid, 'GD7K2N01', '00000000-0000-4000-8000-0000000a1010'::uuid, interval '3 hours'),
    ('00000000-0000-4000-8000-0000000a7012'::uuid, 'GD7K2N02', '00000000-0000-4000-8000-0000000a1011'::uuid, interval '2 hours'),
    ('00000000-0000-4000-8000-0000000a7013'::uuid, 'GD7K2N03', '00000000-0000-4000-8000-0000000a1012'::uuid, interval '90 minutes'),
    ('00000000-0000-4000-8000-0000000a7014'::uuid, 'GD7K2N04', '00000000-0000-4000-8000-0000000a1013'::uuid, interval '1 hour')
  ) AS fixture(delivery_id, public_code, item_id, age)
  JOIN donation_delivery delivery ON delivery.id = fixture.delivery_id AND delivery.public_code = fixture.public_code
                                 AND delivery.drive_id = '00000000-0000-4000-8000-0000000a6010'
                                 AND delivery.status = 'DECLARED'
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO donation_line (delivery_id, revision, item_id, declared_quantity)
SELECT delivery.id, declaration.revision, item.id, fixture.quantity
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000a7011'::uuid, 'GD7K2N01', '00000000-0000-4000-8000-0000000a1010'::uuid, 'Gạo đóng túi TP. Hồ Chí Minh', 25.500::numeric),
    ('00000000-0000-4000-8000-0000000a7012'::uuid, 'GD7K2N02', '00000000-0000-4000-8000-0000000a1011'::uuid, 'Nước uống đóng chai TP. Hồ Chí Minh', 48.000::numeric),
    ('00000000-0000-4000-8000-0000000a7013'::uuid, 'GD7K2N03', '00000000-0000-4000-8000-0000000a1012'::uuid, 'Bộ sơ cứu cộng đồng TP. Hồ Chí Minh', 12.000::numeric),
    ('00000000-0000-4000-8000-0000000a7014'::uuid, 'GD7K2N04', '00000000-0000-4000-8000-0000000a1013'::uuid, 'Chăn giữ nhiệt TP. Hồ Chí Minh', 20.000::numeric)
  ) AS fixture(delivery_id, public_code, item_id, item_name, quantity)
  JOIN donation_delivery delivery ON delivery.id = fixture.delivery_id AND delivery.public_code = fixture.public_code
                                 AND delivery.drive_id = '00000000-0000-4000-8000-0000000a6010'
                                 AND delivery.status = 'DECLARED'
  JOIN donation_declaration declaration ON declaration.delivery_id = delivery.id AND declaration.revision = 1
                                       AND declaration.created_by_kind = 'DONOR'
  JOIN item ON item.id = fixture.item_id AND item.name = fixture.item_name
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO stock_balance (id, warehouse_id, item_id)
SELECT fixture.balance_id, warehouse.id, item.id
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000a5c00'::uuid, '00000000-0000-4000-8000-0000000a1010'::uuid, 'Gạo đóng túi TP. Hồ Chí Minh'),
    ('00000000-0000-4000-8000-0000000a5c01'::uuid, '00000000-0000-4000-8000-0000000a1011'::uuid, 'Nước uống đóng chai TP. Hồ Chí Minh'),
    ('00000000-0000-4000-8000-0000000a5c02'::uuid, '00000000-0000-4000-8000-0000000a1012'::uuid, 'Bộ sơ cứu cộng đồng TP. Hồ Chí Minh'),
    ('00000000-0000-4000-8000-0000000a5c03'::uuid, '00000000-0000-4000-8000-0000000a1013'::uuid, 'Chăn giữ nhiệt TP. Hồ Chí Minh')
  ) AS fixture(balance_id, item_id, item_name)
  JOIN warehouse ON warehouse.id = '00000000-0000-4000-8000-0000000a2010'
                AND warehouse.name = 'Kho phân phối TP. Hồ Chí Minh'
  JOIN item ON item.id = fixture.item_id AND item.name = fixture.item_name
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO stock_movement (balance_id, movement_type, delta_on_hand, delta_reserved, operation_ref, actor_user_id, reason, created_at)
SELECT balance.id, 'OPENING', fixture.quantity, 0, fixture.operation_ref,
       '00000000-0000-4000-8000-000000000112', 'Tồn đầu kỳ kho TP. Hồ Chí Minh (dữ liệu giả lập)', now() - interval '5 days'
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000a5c00'::uuid, '00000000-0000-4000-8000-0000000a2010'::uuid, '00000000-0000-4000-8000-0000000a1010'::uuid, 'Gạo đóng túi TP. Hồ Chí Minh', 80.000::numeric, 'OPEN:DEMO_C:RICE'),
    ('00000000-0000-4000-8000-0000000a5c01'::uuid, '00000000-0000-4000-8000-0000000a2010'::uuid, '00000000-0000-4000-8000-0000000a1011'::uuid, 'Nước uống đóng chai TP. Hồ Chí Minh', 180.000::numeric, 'OPEN:DEMO_C:WATER'),
    ('00000000-0000-4000-8000-0000000a5c02'::uuid, '00000000-0000-4000-8000-0000000a2010'::uuid, '00000000-0000-4000-8000-0000000a1012'::uuid, 'Bộ sơ cứu cộng đồng TP. Hồ Chí Minh', 32.000::numeric, 'OPEN:DEMO_C:MEDICAL'),
    ('00000000-0000-4000-8000-0000000a5c03'::uuid, '00000000-0000-4000-8000-0000000a2010'::uuid, '00000000-0000-4000-8000-0000000a1013'::uuid, 'Chăn giữ nhiệt TP. Hồ Chí Minh', 45.000::numeric, 'OPEN:DEMO_C:BLANKETS')
  ) AS fixture(balance_id, warehouse_id, item_id, item_name, quantity, operation_ref)
  JOIN stock_balance balance ON balance.id = fixture.balance_id
                             AND balance.warehouse_id = fixture.warehouse_id AND balance.item_id = fixture.item_id
  JOIN warehouse ON warehouse.id = fixture.warehouse_id
                AND warehouse.name = 'Kho phân phối TP. Hồ Chí Minh'
  JOIN item ON item.id = fixture.item_id AND item.name = fixture.item_name
 WHERE true
ON CONFLICT DO NOTHING;

-- Need norms for SOS estimates (same demo values as seed-logistics.sql; safe to apply more than once).
INSERT INTO need_norm (category, item_type_code, quantity_basis, qty_adult, qty_child, qty_elderly,
                       people_per_unit, fixed_quantity, default_item_id) VALUES
  ('WATER', 'NUOC_UONG', 'BY_GROUP', 3.000, 1.000, 2.000, NULL, NULL,
     (SELECT id FROM item WHERE item_type_code = 'NUOC_UONG' AND unit_code = 'LIT' ORDER BY name LIMIT 1)),
  ('FOOD', 'LUONG_THUC', 'BY_GROUP', 2.000, 1.000, 1.000, NULL, NULL,
     (SELECT id FROM item WHERE item_type_code = 'LUONG_THUC' AND unit_code = 'KG' ORDER BY name LIMIT 1)),
  ('BLANKET', 'CHAN_MEN', 'PER_N_PEOPLE', 0, 0, 0, 2, NULL,
     (SELECT id FROM item WHERE item_type_code = 'CHAN_MEN' ORDER BY name LIMIT 1)),
  ('MEDICINE', 'Y_TE', 'PER_REQUEST', 0, 0, 0, NULL, 1.000,
     (SELECT id FROM item WHERE item_type_code = 'Y_TE' AND unit_code = 'CAI' ORDER BY name LIMIT 1))
ON CONFLICT (category) DO NOTHING;

-- ---------- regional warehouses and located donation drives ----------
-- Each regional warehouse controls an area LARGER than the relief campaigns inside it (radius 60-140 km against campaign radii of
-- 18-30 km), and every donation drive has its own drop-off point inside the warehouse area so donors can pick the closest one.
-- Campaign areas repeat seed-campaigns.sql (Response owns campaigns; Logistics is a separate database).
-- Safe to apply more than once: warehouse ids are a2c01..a2c08 (regional) and a2d01..a2d15 (fallback), drive ids a6c01..a6c99.
INSERT INTO warehouse (id, name, address_note, location, location_public, service_radius_m) VALUES
  ('00000000-0000-4000-8000-0000000a2c01', 'Kho vùng Đồng bằng sông Hồng',    'Điểm tập kết giả lập khu vực Hà Nội',                 ST_GeogFromText('SRID=4326;POINT(105.8300 21.0200)'), true,  80000),
  ('00000000-0000-4000-8000-0000000a2c02', 'Kho vùng Tây Bắc',                'Điểm tập kết giả lập khu vực Yên Bái – Lào Cai',      ST_GeogFromText('SRID=4326;POINT(104.4000 22.1000)'), true, 140000),
  ('00000000-0000-4000-8000-0000000a2c03', 'Kho vùng Thanh – Nghệ – Tĩnh',    'Điểm tập kết giả lập khu vực Bắc Trung Bộ',           ST_GeogFromText('SRID=4326;POINT(105.7500 19.0000)'), true, 130000),
  ('00000000-0000-4000-8000-0000000a2c04', 'Kho vùng Quảng Bình – Huế',       'Điểm tập kết giả lập khu vực Quảng Bình – Huế',       ST_GeogFromText('SRID=4326;POINT(107.0000 17.0000)'), true, 120000),
  ('00000000-0000-4000-8000-0000000a2c05', 'Kho vùng Đà Nẵng – Quảng Ngãi',   'Điểm tập kết giả lập khu vực Nam Trung Bộ',           ST_GeogFromText('SRID=4326;POINT(108.5000 15.6000)'), true, 100000),
  ('00000000-0000-4000-8000-0000000a2c06', 'Kho vùng Quy Nhơn',               'Điểm tập kết giả lập khu vực Quy Nhơn',               ST_GeogFromText('SRID=4326;POINT(109.1000 13.9000)'), true,  80000),
  ('00000000-0000-4000-8000-0000000a2c07', 'Kho vùng Đông Nam Bộ',            'Điểm tập kết giả lập khu vực TP. Hồ Chí Minh',        ST_GeogFromText('SRID=4326;POINT(106.7000 10.8500)'), true,  60000),
  ('00000000-0000-4000-8000-0000000a2c08', 'Kho vùng Đồng bằng sông Cửu Long','Điểm tập kết giả lập khu vực Cần Thơ – Cà Mau',        ST_GeogFromText('SRID=4326;POINT(105.5000 9.6000)'),  true, 140000)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  c record;
  centre geography;
  pt geography;
  wid uuid;
  did uuid;
  factor numeric;
  n int := 0;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      (1,  '00000000-0000-4000-8000-0000000000c1'::uuid, 'Hà Nội',         105.8500::float8, 21.0300::float8, 30000, 'ACTIVE'),
      (2,  '00000000-0000-4000-8000-0000000000c2'::uuid, 'Hà Nội mở rộng', 105.9000::float8, 21.0300::float8, 18000, 'ACTIVE'),
      (3,  '00000000-0000-4000-8000-0000000000c3'::uuid, 'TP. Hồ Chí Minh', 106.7009::float8, 10.7769::float8, 25000, 'ACTIVE'),
      (4,  '00000000-0000-4000-8000-0000000000c4'::uuid, 'Đà Nẵng',        108.2022::float8, 16.0544::float8, 25000, 'ACTIVE'),
      (5,  '00000000-0000-4000-8000-0000000000c5'::uuid, 'Lào Cai',        103.9710::float8, 22.4856::float8, 25000, 'ACTIVE'),
      (6,  '00000000-0000-4000-8000-0000000000c6'::uuid, 'Huế',            107.5909::float8, 16.4637::float8, 20000, 'PAUSED'),
      (7,  '00000000-0000-4000-8000-0000000000c7'::uuid, 'Cần Thơ',        105.7469::float8, 10.0452::float8, 22000, 'ACTIVE'),
      (8,  '00000000-0000-4000-8000-0000000000c8'::uuid, 'Nghệ An',        105.6923::float8, 18.6796::float8, 20000, 'PAUSED'),
      (9,  '00000000-0000-4000-8000-0000000000c9'::uuid, 'Quảng Bình',     106.6222::float8, 17.4689::float8, 28000, 'ACTIVE'),
      (10, '00000000-0000-4000-8000-0000000000ca'::uuid, 'Hà Tĩnh',        105.9057::float8, 18.3428::float8, 25000, 'ACTIVE'),
      (11, '00000000-0000-4000-8000-0000000000cb'::uuid, 'Quảng Ngãi',     108.8044::float8, 15.1205::float8, 26000, 'ACTIVE'),
      (12, '00000000-0000-4000-8000-0000000000cc'::uuid, 'Quy Nhơn',       109.2196::float8, 13.7765::float8, 22000, 'ACTIVE'),
      (13, '00000000-0000-4000-8000-0000000000cd'::uuid, 'Yên Bái',        104.8985::float8, 21.7168::float8, 30000, 'PAUSED'),
      (14, '00000000-0000-4000-8000-0000000000ce'::uuid, 'Thanh Hóa',      105.7745::float8, 19.8067::float8, 24000, 'PAUSED'),
      (15, '00000000-0000-4000-8000-0000000000cf'::uuid, 'Cà Mau',         105.1500::float8,  9.1769::float8, 25000, 'CLOSED')
    ) AS t(seq, campaign_id, region, lng, lat, radius_m, status)
    ORDER BY seq
  LOOP
    centre := ST_SetSRID(ST_MakePoint(c.lng, c.lat), 4326)::geography;

    -- Fallback for a campaign no warehouse controls: a warehouse twice the campaign radius, so it always out-reaches the campaign.
    IF NOT EXISTS (
      SELECT 1 FROM warehouse w
       WHERE w.status = 'ACTIVE' AND w.location IS NOT NULL AND w.service_radius_m IS NOT NULL
         AND ST_DWithin(w.location, centre, (w.service_radius_m + c.radius_m)::float8)
    ) THEN
      INSERT INTO warehouse (id, name, address_note, location, location_public, service_radius_m)
      VALUES (('00000000-0000-4000-8000-0000000a2d' || lpad(c.seq::text, 2, '0'))::uuid,
              'Kho vùng ' || c.region, 'Địa điểm giả lập phục vụ vùng chiến dịch ' || c.region,
              ST_SetSRID(ST_MakePoint(c.lng + 0.01, c.lat), 4326)::geography, true, least(c.radius_m * 2, 200000))
      ON CONFLICT (id) DO NOTHING;
    END IF;

    CONTINUE WHEN c.status = 'CLOSED';

    -- One or two drop-off points per campaign, at offsets from the campaign centre; the second point exists for the three big cities.
    FOR k IN 1..(CASE WHEN c.seq IN (1, 3, 4) THEN 2 ELSE 1 END) LOOP
      pt := ST_SetSRID(ST_MakePoint(c.lng + CASE k WHEN 1 THEN 0.02 ELSE -0.05 END, c.lat + CASE k WHEN 1 THEN 0.01 ELSE -0.03 END), 4326)::geography;
      -- the warehouse that controls this point (nearest first)
      SELECT w.id INTO wid FROM warehouse w
       WHERE w.status = 'ACTIVE' AND w.location IS NOT NULL AND w.service_radius_m IS NOT NULL
         AND ST_DWithin(w.location, pt, w.service_radius_m::float8)
       ORDER BY ST_Distance(w.location, pt), w.id LIMIT 1;
      CONTINUE WHEN wid IS NULL;

      n := c.seq * 2 + k;
      did := ('00000000-0000-4000-8000-0000000a6c' || lpad(n::text, 2, '0'))::uuid;
      INSERT INTO donation_drive (id, campaign_id, campaign_status, campaign_status_at, intake_warehouse_id, title, description, status,
                                  opens_at, closes_at, created_at, location, location_note)
      VALUES (did, c.campaign_id, c.status, now(), wid,
              CASE k WHEN 1 THEN 'Điểm quyên góp trung tâm ' ELSE 'Điểm quyên góp khu vực phụ ' END || c.region,
              'Tiếp nhận lương thực, nước uống, vật tư y tế và chăn màn cho chiến dịch cứu trợ ' || c.region || ' (dữ liệu giả lập).',
              CASE WHEN c.status = 'ACTIVE' THEN 'OPEN' ELSE 'PAUSED' END,
              now() - interval '1 day', now() + interval '14 days', now() - interval '1 day',
              pt, CASE k WHEN 1 THEN 'Điểm tập kết gần trung tâm ' ELSE 'Điểm tập kết phía tây nam ' END || c.region)
      ON CONFLICT (id) DO NOTHING;

      factor := c.radius_m / 1000.0;
      INSERT INTO drive_item (drive_id, item_id, target_quantity, acceptance_note)
      SELECT did, i.id, i.target, i.note
        FROM (VALUES
          ('00000000-0000-4000-8000-0000000a1001'::uuid, round(factor * 8, 3),  'Gạo còn hạn dùng, đóng túi kín'),
          ('00000000-0000-4000-8000-0000000a1003'::uuid, round(factor * 40, 0), 'Chai nguyên seal'),
          ('00000000-0000-4000-8000-0000000a1005'::uuid, round(factor * 2, 0),  'Bộ sơ cứu đầy đủ dụng cụ cơ bản'),
          ('00000000-0000-4000-8000-0000000a1007'::uuid, round(factor * 3, 0),  NULL::text)
        ) AS i(id, target, note)
        JOIN item ON item.id = i.id
       WHERE EXISTS (SELECT 1 FROM donation_drive d WHERE d.id = did)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- Drives seeded before drives had their own location sit at their warehouse position (always inside its own service area).
UPDATE donation_drive d SET location = w.location, location_note = 'Tại kho tiếp nhận'
  FROM warehouse w
 WHERE w.id = d.intake_warehouse_id AND d.location IS NULL AND w.location IS NOT NULL;

-- ---------- donations received by the regional drives (2026-11-28) ----------
-- Each OPEN regional drive (a6cXX) gets three donations that went through the full intake chain (count by ops_seed, independent
-- APPROVE and posting by reviewer1) and one donation still DECLARED, so the drive list shows real progress against its targets.
-- Ids: deliveries 000000a7dNNk, receipts 000000a8dNNk, reviews 000000acdNNk (NN = drive number, k = 1..4). Safe to apply more than once.
DO $$
DECLARE
  d record;
  it record;
  k int;
  n text;
  del uuid;
  rec uuid;
  bal uuid;
  qty numeric;
  donors text[] := ARRAY['Nhóm thiện nguyện Ánh Dương (giả lập)', 'Hội phụ nữ phường (giả lập)', 'Công ty Thực phẩm An Phát (giả lập)', 'Nhà hảo tâm ẩn danh (giả lập)'];
BEGIN
  FOR d IN
    SELECT drive.id, drive.intake_warehouse_id, substr(drive.id::text, 35, 2) AS num
      FROM donation_drive drive
     WHERE drive.id::text LIKE '00000000-0000-4000-8000-0000000a6c%' AND drive.status = 'OPEN'
     ORDER BY drive.id
  LOOP
    n := d.num;
    FOR k IN 1..4 LOOP
      del := ('00000000-0000-4000-8000-000000a7d' || n || k)::uuid;
      CONTINUE WHEN EXISTS (SELECT 1 FROM donation_delivery WHERE id = del);
      -- k-th item of the drive (wraps around), donated at roughly 15-35% of the drive target
      SELECT di.item_id, di.target_quantity INTO it
        FROM drive_item di WHERE di.drive_id = d.id ORDER BY di.item_id OFFSET ((k - 1) % 4) LIMIT 1;
      CONTINUE WHEN it.item_id IS NULL;
      qty := greatest(1, floor(it.target_quantity * (0.15 + 0.05 * k)));

      INSERT INTO donation_delivery (id, public_code, drive_id, donor_name, donor_phone, capability_hash, status, created_at)
      VALUES (del, 'GDRS' || n || k || 'Q', d.id, donors[k], '09000004' || n, NULL, 'DECLARED', now() - (5 - k) * interval '18 hours');
      INSERT INTO donation_declaration (delivery_id, revision, created_by_kind, created_at)
      VALUES (del, 1, 'DONOR', now() - (5 - k) * interval '18 hours');
      INSERT INTO donation_line (delivery_id, revision, item_id, declared_quantity) VALUES (del, 1, it.item_id, qty);
      CONTINUE WHEN k = 4;

      rec := ('00000000-0000-4000-8000-000000a8d' || n || k)::uuid;
      INSERT INTO donation_receipt (id, delivery_id, warehouse_id, created_at)
      VALUES (rec, del, d.intake_warehouse_id, now() - (5 - k) * interval '18 hours' + interval '2 hours');
      INSERT INTO receipt_count (receipt_id, revision, counted_by_user_id, counted_at, note)
      VALUES (rec, 1, '00000000-0000-4000-8000-000000000112', now() - (5 - k) * interval '18 hours' + interval '3 hours', 'Đã đếm đủ theo khai báo');
      INSERT INTO receipt_count_line (receipt_id, revision, item_id, counted_quantity, accepted_quantity, held_quantity, rejected_quantity, condition_note, expiry_date)
      VALUES (rec, 1, it.item_id, qty, qty, 0, 0, 'Hàng nguyên vẹn', NULL);
      INSERT INTO receipt_review (id, receipt_id, delivery_id, count_revision, declaration_revision, reviewer_user_id, decision, reason, reviewed_at)
      VALUES (('00000000-0000-4000-8000-000000acd' || n || k)::uuid, rec, del, 1, 1, '00000000-0000-4000-8000-000000000108', 'APPROVE', NULL,
              now() - (5 - k) * interval '18 hours' + interval '4 hours');

      INSERT INTO stock_balance (id, warehouse_id, item_id) VALUES (gen_random_uuid(), d.intake_warehouse_id, it.item_id)
      ON CONFLICT (warehouse_id, item_id) DO NOTHING;
      SELECT sb.id INTO bal FROM stock_balance sb WHERE sb.warehouse_id = d.intake_warehouse_id AND sb.item_id = it.item_id;
      INSERT INTO stock_movement (balance_id, movement_type, delta_on_hand, delta_reserved, receipt_id, operation_ref, actor_user_id, created_at)
      VALUES (bal, 'RECEIPT', qty, 0, rec, 'RCPT:' || rec || ':' || it.item_id, '00000000-0000-4000-8000-000000000108',
              now() - (5 - k) * interval '18 hours' + interval '4 hours');
      UPDATE donation_delivery SET status = 'POSTED' WHERE id = del;
    END LOOP;
  END LOOP;
END $$;

-- ---------- open relief needs for an SOS that asked for goods (2026-11-28) ----------
-- C48DEM0003 (campaign c1, needs relief supplies) has an OPEN fulfillment cycle: rice, water and blankets nobody has reserved yet.
-- These needs feed the supply-gap inbox of the campaign's primary warehouse and the team's "cần hàng" view.
INSERT INTO fulfillment_cycle (id, request_id, work_cycle, campaign_id, state, created_at)
SELECT '00000000-0000-4000-8000-0000000b7003', '00000000-0000-4000-8000-0000000000f3', 1, '00000000-0000-4000-8000-0000000000c1', 'OPEN', now() - interval '150 minutes'
 WHERE NOT EXISTS (SELECT 1 FROM fulfillment_cycle WHERE request_id = '00000000-0000-4000-8000-0000000000f3' AND work_cycle = 1);

INSERT INTO relief_need (id, cycle_id, item_id, original_quantity, requested_quantity, cancelled_remaining, status, created_at)
SELECT fixture.id, '00000000-0000-4000-8000-0000000b7003', fixture.item_id, fixture.quantity, fixture.quantity, NULL, 'OPEN', now() - interval '140 minutes'
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000b1031'::uuid, '00000000-0000-4000-8000-0000000a1001'::uuid, 12::numeric),
    ('00000000-0000-4000-8000-0000000b1032'::uuid, '00000000-0000-4000-8000-0000000a1003'::uuid, 24::numeric),
    ('00000000-0000-4000-8000-0000000b1033'::uuid, '00000000-0000-4000-8000-0000000a1007'::uuid, 2::numeric)
  ) AS fixture(id, item_id, quantity)
  JOIN item ON item.id = fixture.item_id
 WHERE EXISTS (SELECT 1 FROM fulfillment_cycle WHERE id = '00000000-0000-4000-8000-0000000b7003')
ON CONFLICT DO NOTHING;
