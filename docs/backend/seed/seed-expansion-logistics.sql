-- Additive synthetic Logistics fixtures. Safe to apply more than once.
INSERT INTO unit (code, display_name, scale) VALUES
  ('CAI', 'cái', 0), ('KG', 'kg', 3), ('THUNG', 'thùng', 0)
ON CONFLICT DO NOTHING;
INSERT INTO item_type (code, display_name) VALUES
  ('LUONG_THUC', 'Lương thực'), ('NUOC_UONG', 'Nước uống'), ('Y_TE', 'Vật tư y tế'), ('CHAN_MEN', 'Chăn màn, nơi trú ẩn')
ON CONFLICT DO NOTHING;

INSERT INTO item (id, item_type_code, unit_code, name)
SELECT fixture.id, fixture.item_type_code, fixture.unit_code, fixture.name
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000a1010'::uuid, 'LUONG_THUC', 'KG', 'Gạo đóng túi Demo C', 'Lương thực', 'kg', 3),
    ('00000000-0000-4000-8000-0000000a1011'::uuid, 'NUOC_UONG', 'CAI', 'Nước uống đóng chai Demo C', 'Nước uống', 'cái', 0),
    ('00000000-0000-4000-8000-0000000a1012'::uuid, 'Y_TE', 'CAI', 'Bộ sơ cứu cộng đồng Demo C', 'Vật tư y tế', 'cái', 0),
    ('00000000-0000-4000-8000-0000000a1013'::uuid, 'CHAN_MEN', 'CAI', 'Chăn giữ nhiệt Demo C', 'Chăn màn, nơi trú ẩn', 'cái', 0)
  ) AS fixture(id, item_type_code, unit_code, name, item_type_name, unit_name, unit_scale)
  JOIN item_type item_type ON item_type.code = fixture.item_type_code AND item_type.display_name = fixture.item_type_name
  JOIN unit unit ON unit.code = fixture.unit_code AND unit.display_name = fixture.unit_name AND unit.scale = fixture.unit_scale
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO warehouse (id, organization_id, region_code, name, address_note, location, location_public) VALUES
  ('00000000-0000-4000-8000-0000000a2010', '00000000-0000-4000-8000-000000000001', 'DEMO_C', 'Kho phân phối Bắc Demo C',
   'Địa điểm giả lập phục vụ trình diễn tại Demo C', ST_GeogFromText('SRID=4326;POINT(105.8800 21.0400)'), false)
ON CONFLICT DO NOTHING;

INSERT INTO donation_drive (id, campaign_id, campaign_status, campaign_status_at, organization_id, intake_warehouse_id,
                           title, description, status, opens_at, closes_at, created_at)
SELECT fixture.id, fixture.campaign_id, 'ACTIVE', now(), fixture.organization_id, warehouse.id,
       fixture.title, fixture.description, 'OPEN', now() - interval '1 day', now() + interval '12 days', now() - interval '1 day'
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000a6010'::uuid, '00000000-0000-4000-8000-0000000000c3'::uuid,
     '00000000-0000-4000-8000-000000000001'::uuid, 'Quyên góp nhu yếu phẩm khu vực Bắc Demo C',
     'Tiếp nhận lương thực, nước uống, vật tư y tế và chăn màn tại kho giả lập Demo C.')
  ) AS fixture(id, campaign_id, organization_id, title, description)
  JOIN warehouse ON warehouse.id = '00000000-0000-4000-8000-0000000a2010'
                AND warehouse.organization_id = fixture.organization_id
                AND warehouse.region_code = 'DEMO_C'
                AND warehouse.name = 'Kho phân phối Bắc Demo C'
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO drive_item (drive_id, item_id, target_quantity, acceptance_note)
SELECT drive.id, item.id, fixture.target_quantity, fixture.acceptance_note
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000a6010'::uuid, 'Quyên góp nhu yếu phẩm khu vực Bắc Demo C', '00000000-0000-4000-8000-0000000a1010'::uuid, 'Gạo đóng túi Demo C', 100.000::numeric, 'Bao gói nguyên vẹn, còn hạn sử dụng'),
    ('00000000-0000-4000-8000-0000000a6010'::uuid, 'Quyên góp nhu yếu phẩm khu vực Bắc Demo C', '00000000-0000-4000-8000-0000000a1011'::uuid, 'Nước uống đóng chai Demo C', 240.000::numeric, 'Chai nguyên niêm phong'),
    ('00000000-0000-4000-8000-0000000a6010'::uuid, 'Quyên góp nhu yếu phẩm khu vực Bắc Demo C', '00000000-0000-4000-8000-0000000a1012'::uuid, 'Bộ sơ cứu cộng đồng Demo C', 40.000::numeric, 'Bộ dụng cụ còn nguyên vẹn'),
    ('00000000-0000-4000-8000-0000000a6010'::uuid, 'Quyên góp nhu yếu phẩm khu vực Bắc Demo C', '00000000-0000-4000-8000-0000000a1013'::uuid, 'Chăn giữ nhiệt Demo C', 60.000::numeric, NULL::text)
  ) AS fixture(drive_id, drive_title, item_id, item_name, target_quantity, acceptance_note)
  JOIN donation_drive drive ON drive.id = fixture.drive_id AND drive.title = fixture.drive_title
                           AND drive.campaign_id = '00000000-0000-4000-8000-0000000000c3'
                           AND drive.organization_id = '00000000-0000-4000-8000-000000000001'
                           AND drive.intake_warehouse_id = '00000000-0000-4000-8000-0000000a2010'
                           AND drive.campaign_status = 'ACTIVE' AND drive.status = 'OPEN'
  JOIN item ON item.id = fixture.item_id AND item.name = fixture.item_name
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO donation_delivery (id, public_code, drive_id, organization_id, donor_name, donor_phone, capability_hash, status, created_at)
SELECT fixture.id, fixture.public_code, drive.id, drive.organization_id, fixture.donor_name, fixture.donor_phone,
       fixture.capability_hash, 'DECLARED', now() - fixture.age
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000a7011'::uuid, 'GD7K2N01', 'Nhà hảo tâm giả lập 11', '0900000301', '{{donation_capability_hash}}', interval '3 hours'),
    ('00000000-0000-4000-8000-0000000a7012'::uuid, 'GD7K2N02', 'Nhà hảo tâm giả lập 12', '0900000302', NULL::text, interval '2 hours'),
    ('00000000-0000-4000-8000-0000000a7013'::uuid, 'GD7K2N03', 'Nhà hảo tâm giả lập 13', '0900000303', NULL::text, interval '90 minutes'),
    ('00000000-0000-4000-8000-0000000a7014'::uuid, 'GD7K2N04', 'Nhà hảo tâm giả lập 14', '0900000304', NULL::text, interval '1 hour')
  ) AS fixture(id, public_code, donor_name, donor_phone, capability_hash, age)
  JOIN donation_drive drive ON drive.id = '00000000-0000-4000-8000-0000000a6010'
                           AND drive.title = 'Quyên góp nhu yếu phẩm khu vực Bắc Demo C'
                           AND drive.campaign_id = '00000000-0000-4000-8000-0000000000c3'
                           AND drive.organization_id = '00000000-0000-4000-8000-000000000001'
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
                                 AND delivery.organization_id = '00000000-0000-4000-8000-000000000001' AND delivery.status = 'DECLARED'
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO donation_line (delivery_id, revision, item_id, declared_quantity)
SELECT delivery.id, declaration.revision, item.id, fixture.quantity
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000a7011'::uuid, 'GD7K2N01', '00000000-0000-4000-8000-0000000a1010'::uuid, 'Gạo đóng túi Demo C', 25.500::numeric),
    ('00000000-0000-4000-8000-0000000a7012'::uuid, 'GD7K2N02', '00000000-0000-4000-8000-0000000a1011'::uuid, 'Nước uống đóng chai Demo C', 48.000::numeric),
    ('00000000-0000-4000-8000-0000000a7013'::uuid, 'GD7K2N03', '00000000-0000-4000-8000-0000000a1012'::uuid, 'Bộ sơ cứu cộng đồng Demo C', 12.000::numeric),
    ('00000000-0000-4000-8000-0000000a7014'::uuid, 'GD7K2N04', '00000000-0000-4000-8000-0000000a1013'::uuid, 'Chăn giữ nhiệt Demo C', 20.000::numeric)
  ) AS fixture(delivery_id, public_code, item_id, item_name, quantity)
  JOIN donation_delivery delivery ON delivery.id = fixture.delivery_id AND delivery.public_code = fixture.public_code
                                 AND delivery.drive_id = '00000000-0000-4000-8000-0000000a6010'
                                 AND delivery.organization_id = '00000000-0000-4000-8000-000000000001' AND delivery.status = 'DECLARED'
  JOIN donation_declaration declaration ON declaration.delivery_id = delivery.id AND declaration.revision = 1
                                       AND declaration.created_by_kind = 'DONOR'
  JOIN item ON item.id = fixture.item_id AND item.name = fixture.item_name
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO stock_balance (id, warehouse_id, item_id)
SELECT fixture.balance_id, warehouse.id, item.id
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000a5c00'::uuid, '00000000-0000-4000-8000-0000000a1010'::uuid, 'Gạo đóng túi Demo C'),
    ('00000000-0000-4000-8000-0000000a5c01'::uuid, '00000000-0000-4000-8000-0000000a1011'::uuid, 'Nước uống đóng chai Demo C'),
    ('00000000-0000-4000-8000-0000000a5c02'::uuid, '00000000-0000-4000-8000-0000000a1012'::uuid, 'Bộ sơ cứu cộng đồng Demo C'),
    ('00000000-0000-4000-8000-0000000a5c03'::uuid, '00000000-0000-4000-8000-0000000a1013'::uuid, 'Chăn giữ nhiệt Demo C')
  ) AS fixture(balance_id, item_id, item_name)
  JOIN warehouse ON warehouse.id = '00000000-0000-4000-8000-0000000a2010'
                AND warehouse.organization_id = '00000000-0000-4000-8000-000000000001'
                AND warehouse.region_code = 'DEMO_C' AND warehouse.name = 'Kho phân phối Bắc Demo C'
  JOIN item ON item.id = fixture.item_id AND item.name = fixture.item_name
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO stock_movement (balance_id, movement_type, delta_on_hand, delta_reserved, operation_ref, actor_user_id, reason, created_at)
SELECT balance.id, 'OPENING', fixture.quantity, 0, fixture.operation_ref,
       '00000000-0000-4000-8000-000000000112', 'Tồn đầu kỳ kho Demo C (dữ liệu giả lập)', now() - interval '5 days'
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000a5c00'::uuid, '00000000-0000-4000-8000-0000000a2010'::uuid, '00000000-0000-4000-8000-0000000a1010'::uuid, 'Gạo đóng túi Demo C', 80.000::numeric, 'OPEN:DEMO_C:RICE'),
    ('00000000-0000-4000-8000-0000000a5c01'::uuid, '00000000-0000-4000-8000-0000000a2010'::uuid, '00000000-0000-4000-8000-0000000a1011'::uuid, 'Nước uống đóng chai Demo C', 180.000::numeric, 'OPEN:DEMO_C:WATER'),
    ('00000000-0000-4000-8000-0000000a5c02'::uuid, '00000000-0000-4000-8000-0000000a2010'::uuid, '00000000-0000-4000-8000-0000000a1012'::uuid, 'Bộ sơ cứu cộng đồng Demo C', 32.000::numeric, 'OPEN:DEMO_C:MEDICAL'),
    ('00000000-0000-4000-8000-0000000a5c03'::uuid, '00000000-0000-4000-8000-0000000a2010'::uuid, '00000000-0000-4000-8000-0000000a1013'::uuid, 'Chăn giữ nhiệt Demo C', 45.000::numeric, 'OPEN:DEMO_C:BLANKETS')
  ) AS fixture(balance_id, warehouse_id, item_id, item_name, quantity, operation_ref)
  JOIN stock_balance balance ON balance.id = fixture.balance_id
                             AND balance.warehouse_id = fixture.warehouse_id AND balance.item_id = fixture.item_id
  JOIN warehouse ON warehouse.id = fixture.warehouse_id
                AND warehouse.organization_id = '00000000-0000-4000-8000-000000000001'
                AND warehouse.region_code = 'DEMO_C' AND warehouse.name = 'Kho phân phối Bắc Demo C'
  JOIN item ON item.id = fixture.item_id AND item.name = fixture.item_name
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO distribution (id, warehouse_id, organization_id, campaign_id, purpose, status, preparer_user_id, created_at)
SELECT fixture.id, warehouse.id, warehouse.organization_id, fixture.campaign_id, 'CAMPAIGN_DISTRIBUTION', 'DRAFT',
       '00000000-0000-4000-8000-000000000112', now() - interval '2 hours'
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000b3010'::uuid, '00000000-0000-4000-8000-0000000a2010'::uuid,
     '00000000-0000-4000-8000-0000000000c3'::uuid)
  ) AS fixture(id, warehouse_id, campaign_id)
  JOIN warehouse ON warehouse.id = fixture.warehouse_id AND warehouse.organization_id = '00000000-0000-4000-8000-000000000001'
                AND warehouse.region_code = 'DEMO_C' AND warehouse.name = 'Kho phân phối Bắc Demo C'
 WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO distribution_line (id, distribution_id, warehouse_id, item_id, quantity)
SELECT fixture.id, distribution.id, warehouse.id, item.id, fixture.quantity
  FROM (VALUES
    ('00000000-0000-4000-8000-0000000b4010'::uuid, '00000000-0000-4000-8000-0000000b3010'::uuid, '00000000-0000-4000-8000-0000000a2010'::uuid, '00000000-0000-4000-8000-0000000a1010'::uuid, 'Gạo đóng túi Demo C', 25.000::numeric),
    ('00000000-0000-4000-8000-0000000b4011'::uuid, '00000000-0000-4000-8000-0000000b3010'::uuid, '00000000-0000-4000-8000-0000000a2010'::uuid, '00000000-0000-4000-8000-0000000a1011'::uuid, 'Nước uống đóng chai Demo C', 36.000::numeric)
  ) AS fixture(id, distribution_id, warehouse_id, item_id, item_name, quantity)
  JOIN distribution ON distribution.id = fixture.distribution_id
                   AND distribution.warehouse_id = fixture.warehouse_id
                   AND distribution.purpose = 'CAMPAIGN_DISTRIBUTION' AND distribution.status = 'DRAFT'
                   AND distribution.campaign_id = '00000000-0000-4000-8000-0000000000c3'
                   AND distribution.preparer_user_id = '00000000-0000-4000-8000-000000000112'
                   AND distribution.organization_id = '00000000-0000-4000-8000-000000000001'
  JOIN warehouse ON warehouse.id = fixture.warehouse_id
                AND warehouse.organization_id = '00000000-0000-4000-8000-000000000001'
                AND warehouse.region_code = 'DEMO_C' AND warehouse.name = 'Kho phân phối Bắc Demo C'
  JOIN item ON item.id = fixture.item_id AND item.name = fixture.item_name
 WHERE true
ON CONFLICT DO NOTHING;
