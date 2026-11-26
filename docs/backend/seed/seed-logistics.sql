-- C48 Logistics service: synthetic demo seed (docs/backend/00-setup.md "Seed files"; plan section 17 demonstration).
-- Loads into a freshly created database that already holds schema/logistics.sql:
--   psql -v ON_ERROR_STOP=1 -f schema/logistics.sql -f seed/seed-logistics.sql
-- All data is synthetic: no real people, phones are 0900000xxx, hashes are placeholders. Stock is created only by stock_movement inserts
-- (the apply_stock_movement trigger updates balances); balances are pre-inserted at zero. No trigger is disabled.
-- Cross-service ids (fixed, shared with seed-identity.sql / seed-response.sql):
--   ORG_COORD 00000000-0000-4000-8000-000000000001   CAMPAIGN_ACTIVE ...0000000000c1   REQUEST_AID ...0000000000f5 (work_cycle 1)
--   users: coord1 ...102, ops_mgr ...105, ops_seed ...112, reviewer1 ...108, reviewer2 ...109
-- Local ids use the prefix 00000000-0000-4000-8000-0000000 + a 5-hex suffix (a1xxx items, a2xxx warehouses,
-- a5xxx balances, a6xxx drives, a7xxx deliveries, a8xxx receipts, a9xxx disputes, b1xxx needs, b2xxx commitments, b3xxx supply requests,
-- b7xxx cycle, b8xxx adjustment). Response mission ...0000000000b1 (team ...a1 "Đội xuồng cứu hộ 1", leader ...10c) carries the supply requests.
BEGIN;

-- ---------- catalogs ----------
INSERT INTO unit (code, display_name, scale) VALUES
  ('CAI',   'cái',   0),
  ('KG',    'kg',    3),
  ('LIT',   'lít',   3),
  ('THUNG', 'thùng', 0);

INSERT INTO item_type (code, display_name) VALUES
  ('LUONG_THUC', 'Lương thực'),
  ('NUOC_UONG',  'Nước uống'),
  ('Y_TE',       'Vật tư y tế'),
  ('CHAN_MEN',   'Chăn màn, nơi trú ẩn');

-- returnable=false marks consumables (food, water, medicine and dressings) that cannot come back to stock (proposal 3.6).
INSERT INTO item (id, item_type_code, unit_code, name, returnable, aliases) VALUES
  ('00000000-0000-4000-8000-0000000a1001', 'LUONG_THUC', 'KG',    'Gạo', false, ARRAY['gạo']::text[]),
  ('00000000-0000-4000-8000-0000000a1002', 'LUONG_THUC', 'CAI',   'Mì gói', false, ARRAY['mì tôm','mì ăn liền']::text[]),
  ('00000000-0000-4000-8000-0000000a1003', 'NUOC_UONG',  'CAI',   'Nước đóng chai', false, ARRAY['nước suối','nước lọc','nuoc']::text[]),
  ('00000000-0000-4000-8000-0000000a1004', 'NUOC_UONG',  'LIT',   'Nước sạch đóng can', false, ARRAY['nước sạch','nước can']::text[]),
  ('00000000-0000-4000-8000-0000000a1005', 'Y_TE',       'CAI',   'Bộ sơ cứu', false, ARRAY['thuốc','thuốc men','sơ cứu']::text[]),
  ('00000000-0000-4000-8000-0000000a1006', 'Y_TE',       'THUNG', 'Băng gạc y tế', false, ARRAY['băng gạc','băng y tế']::text[]),
  ('00000000-0000-4000-8000-0000000a1007', 'CHAN_MEN',   'CAI',   'Chăn', true, ARRAY['chăn','chăn ấm']::text[]),
  ('00000000-0000-4000-8000-0000000a1008', 'CHAN_MEN',   'CAI',   'Màn chống muỗi', true, ARRAY['màn','mùng']::text[]);

-- ---------- need norms (demo estimate table; managed by OPERATIONS_MANAGER) ----------
-- One norm per category. The quantity basis says how the SOS facts turn into a quantity:
--   BY_GROUP      adults*qty_adult + children*qty_child + elderly*qty_elderly (adults = people - children - elderly)
--   PER_N_PEOPLE  ceil(people / people_per_unit)
--   PER_REQUEST   fixed_quantity once per SOS
-- Quantities are in the unit of the default item (litre water, kg rice, pieces). default_item_id picks a seeded item of
-- the category's item type; the coordinator may choose another active item of the same type.
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

-- ---------- assets ----------
INSERT INTO warehouse (id, name, address_note, location, location_public, service_radius_m) VALUES
  ('00000000-0000-4000-8000-0000000a2001', 'Kho trung tâm A',
   'Số 10 đường Mẫu, khu A (dữ liệu giả lập)', ST_GeogFromText('SRID=4326;POINT(106.6300 10.8200)'), true, 20000),
  ('00000000-0000-4000-8000-0000000a2002', 'Kho B',
   'Số 25 đường Thử nghiệm, khu B (dữ liệu giả lập)', ST_GeogFromText('SRID=4326;POINT(108.2000 16.0700)'), false, 30000);

-- ---------- zero balances first (warehouse A: a5a01..a5a08, warehouse B: a5b01..a5b08; item order as in the item table) ----------
INSERT INTO stock_balance (id, warehouse_id, item_id)
SELECT ('00000000-0000-4000-8000-0000000a5' || w.tag || '0' || right(i.id::text, 1))::uuid, w.id, i.id
FROM (VALUES ('a', '00000000-0000-4000-8000-0000000a2001'::uuid), ('b', '00000000-0000-4000-8000-0000000a2002'::uuid)) AS w(tag, id)
CROSS JOIN item i;

-- ---------- OPENING stock (actor ops_mgr) ----------
INSERT INTO stock_movement (balance_id, movement_type, delta_on_hand, delta_reserved, operation_ref, actor_user_id, reason, created_at) VALUES
  ('00000000-0000-4000-8000-0000000a5a01', 'OPENING', 800.000, 0, 'OPEN:A:GAO',     '00000000-0000-4000-8000-000000000105', 'Tồn đầu kỳ kho A (dữ liệu giả lập)', now() - interval '10 days'),
  ('00000000-0000-4000-8000-0000000a5a02', 'OPENING', 200,     0, 'OPEN:A:MIGOI',   '00000000-0000-4000-8000-000000000105', 'Tồn đầu kỳ kho A (dữ liệu giả lập)', now() - interval '10 days'),
  ('00000000-0000-4000-8000-0000000a5a03', 'OPENING', 100,     0, 'OPEN:A:NUOC',    '00000000-0000-4000-8000-000000000105', 'Tồn đầu kỳ kho A (dữ liệu giả lập)', now() - interval '10 days'),
  ('00000000-0000-4000-8000-0000000a5a04', 'OPENING', 1500.500, 0, 'OPEN:A:NUOCCAN', '00000000-0000-4000-8000-000000000105', 'Tồn đầu kỳ kho A (dữ liệu giả lập)', now() - interval '10 days'),
  ('00000000-0000-4000-8000-0000000a5a05', 'OPENING', 100,     0, 'OPEN:A:SOCUU',   '00000000-0000-4000-8000-000000000105', 'Tồn đầu kỳ kho A (dữ liệu giả lập)', now() - interval '10 days'),
  ('00000000-0000-4000-8000-0000000a5a06', 'OPENING', 30,      0, 'OPEN:A:BANGGAC', '00000000-0000-4000-8000-000000000105', 'Tồn đầu kỳ kho A (dữ liệu giả lập)', now() - interval '10 days'),
  ('00000000-0000-4000-8000-0000000a5a07', 'OPENING', 150,     0, 'OPEN:A:CHAN',    '00000000-0000-4000-8000-000000000105', 'Tồn đầu kỳ kho A (dữ liệu giả lập)', now() - interval '10 days'),
  ('00000000-0000-4000-8000-0000000a5b01', 'OPENING', 500.000, 0, 'OPEN:B:GAO',     '00000000-0000-4000-8000-000000000105', 'Tồn đầu kỳ kho B (dữ liệu giả lập)', now() - interval '10 days'),
  ('00000000-0000-4000-8000-0000000a5b02', 'OPENING', 120,     0, 'OPEN:B:MIGOI',   '00000000-0000-4000-8000-000000000105', 'Tồn đầu kỳ kho B (dữ liệu giả lập)', now() - interval '10 days'),
  ('00000000-0000-4000-8000-0000000a5b05', 'OPENING', 40,      0, 'OPEN:B:SOCUU',   '00000000-0000-4000-8000-000000000105', 'Tồn đầu kỳ kho B (dữ liệu giả lập)', now() - interval '10 days'),
  ('00000000-0000-4000-8000-0000000a5b07', 'OPENING', 150,     0, 'OPEN:B:CHAN',    '00000000-0000-4000-8000-000000000105', 'Tồn đầu kỳ kho B (dữ liệu giả lập)', now() - interval '10 days'),
  ('00000000-0000-4000-8000-0000000a5b08', 'OPENING', 60,      0, 'OPEN:B:MAN',     '00000000-0000-4000-8000-000000000105', 'Tồn đầu kỳ kho B (dữ liệu giả lập)', now() - interval '10 days');

-- ---------- donation drives (intake warehouse A; campaign status is the cached copy from Response) ----------
INSERT INTO donation_drive (id, campaign_id, campaign_status, campaign_status_at, intake_warehouse_id, title, description, status, opens_at, closes_at, created_at) VALUES
  ('00000000-0000-4000-8000-0000000a6001', '00000000-0000-4000-8000-0000000000c1', 'ACTIVE', now() - interval '1 minute', '00000000-0000-4000-8000-0000000a2001',
   'Quyên góp nhu yếu phẩm cho vùng ngập khu A', 'Tiếp nhận lương thực, nước uống và chăn màn tại kho trung tâm A. Dữ liệu giả lập phục vụ trình diễn.',
   'OPEN', now() - interval '9 days', now() + interval '20 days', now() - interval '9 days'),
  ('00000000-0000-4000-8000-0000000a6002', '00000000-0000-4000-8000-0000000000c1', 'ACTIVE', now() - interval '1 minute', '00000000-0000-4000-8000-0000000a2002',
   'Quyên góp vật tư y tế đợt 2 (bản nháp)', 'Bản nháp chưa công bố: vật tư y tế cho kho B.',
   'DRAFT', NULL, NULL, now() - interval '1 day');

INSERT INTO drive_item (drive_id, item_id, target_quantity, acceptance_note) VALUES
  ('00000000-0000-4000-8000-0000000a6001', '00000000-0000-4000-8000-0000000a1001', 300.000, 'Gạo còn hạn dùng, đóng túi kín'),
  ('00000000-0000-4000-8000-0000000a6001', '00000000-0000-4000-8000-0000000a1002', 500,     'Mì gói còn hạn trên 3 tháng'),
  ('00000000-0000-4000-8000-0000000a6001', '00000000-0000-4000-8000-0000000a1003', 400,     'Chai nguyên seal'),
  ('00000000-0000-4000-8000-0000000a6001', '00000000-0000-4000-8000-0000000a1007', 100,     NULL),
  ('00000000-0000-4000-8000-0000000a6002', '00000000-0000-4000-8000-0000000a1005', 50,      'Bộ sơ cứu đầy đủ dụng cụ cơ bản'),
  ('00000000-0000-4000-8000-0000000a6002', '00000000-0000-4000-8000-0000000a1006', 40,      NULL);

-- ---------- donations ----------
-- IDs: deliveries a7001..a7004, receipts a8002..a8004 (no receipt for the declared-only delivery), dispute a9001.
INSERT INTO donation_delivery (id, public_code, drive_id, donor_name, donor_phone, capability_hash, status, created_at) VALUES
  ('00000000-0000-4000-8000-0000000a7001', 'GD7K2M01', '00000000-0000-4000-8000-0000000a6001',
   'Nhà hảo tâm giả lập 01', '0900000001', 'demo-capability-hash-0001', 'DECLARED', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000a7002', 'GD7K2M02', '00000000-0000-4000-8000-0000000a6001',
   'Nhà hảo tâm giả lập 02', '0900000002', 'demo-capability-hash-0002', 'DECLARED', now() - interval '6 days'),
  ('00000000-0000-4000-8000-0000000a7003', 'GD7K2M03', '00000000-0000-4000-8000-0000000a6001',
   'Nhà hảo tâm giả lập 03', '0900000003', 'demo-capability-hash-0003', 'DECLARED', now() - interval '5 days'),
  ('00000000-0000-4000-8000-0000000a7004', 'GD7K2M04', '00000000-0000-4000-8000-0000000a6001',
   'Nhà hảo tâm giả lập 04', '0900000004', 'demo-capability-hash-0004', 'DECLARED', now() - interval '3 hours');

INSERT INTO donation_declaration (delivery_id, revision, created_by_kind, created_at) VALUES
  ('00000000-0000-4000-8000-0000000a7001', 1, 'DONOR', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000a7002', 1, 'DONOR', now() - interval '6 days'),
  ('00000000-0000-4000-8000-0000000a7003', 1, 'DONOR', now() - interval '5 days'),
  ('00000000-0000-4000-8000-0000000a7004', 1, 'DONOR', now() - interval '3 hours');

INSERT INTO donation_line (delivery_id, revision, item_id, declared_quantity) VALUES
  ('00000000-0000-4000-8000-0000000a7001', 1, '00000000-0000-4000-8000-0000000a1007', 10),        -- D1: 10 chăn
  ('00000000-0000-4000-8000-0000000a7002', 1, '00000000-0000-4000-8000-0000000a1002', 60),        -- D2: 60 mì gói
  ('00000000-0000-4000-8000-0000000a7003', 1, '00000000-0000-4000-8000-0000000a1003', 55),        -- D3: 55 nước đóng chai
  ('00000000-0000-4000-8000-0000000a7004', 1, '00000000-0000-4000-8000-0000000a1001', 25.500);    -- D4: 25,5 kg gạo

INSERT INTO donation_receipt (id, delivery_id, warehouse_id, created_at) VALUES
  ('00000000-0000-4000-8000-0000000a8002', '00000000-0000-4000-8000-0000000a7002', '00000000-0000-4000-8000-0000000a2001', now() - interval '5 days 20 hours'),
  ('00000000-0000-4000-8000-0000000a8003', '00000000-0000-4000-8000-0000000a7003', '00000000-0000-4000-8000-0000000a2001', now() - interval '4 days 20 hours'),
  ('00000000-0000-4000-8000-0000000a8004', '00000000-0000-4000-8000-0000000a7004', '00000000-0000-4000-8000-0000000a2001', now() - interval '2 hours');

-- Counts. D2 rev1 by ops_seed; D3 rev1 by ops_seed and rev2 (held released) by ops_mgr; D4 rev1 by ops_mgr (pending, not reviewed).
INSERT INTO receipt_count (receipt_id, revision, counted_by_user_id, counted_at, note) VALUES
  ('00000000-0000-4000-8000-0000000a8002', 1, '00000000-0000-4000-8000-000000000112', now() - interval '5 days 18 hours', 'Đếm 58 gói, 3 gói rách bao bì bị loại'),
  ('00000000-0000-4000-8000-0000000a8003', 1, '00000000-0000-4000-8000-000000000112', now() - interval '4 days 18 hours', 'Giữ lại 5 chai chờ kiểm tra hạn dùng'),
  ('00000000-0000-4000-8000-0000000a8003', 2, '00000000-0000-4000-8000-000000000105', now() - interval '3 days',          'Kiểm tra lại: 5 chai còn hạn, chuyển sang chấp nhận'),
  ('00000000-0000-4000-8000-0000000a8004', 1, '00000000-0000-4000-8000-000000000105', now() - interval '2 hours',          'Đã cân và đếm xong, chờ người duyệt độc lập');

INSERT INTO receipt_count_line (receipt_id, revision, item_id, counted_quantity, accepted_quantity, held_quantity, rejected_quantity, condition_note, expiry_date) VALUES
  ('00000000-0000-4000-8000-0000000a8002', 1, '00000000-0000-4000-8000-0000000a1002', 58, 55, 0, 3, '3 gói rách bao bì', current_date + 120),
  ('00000000-0000-4000-8000-0000000a8003', 1, '00000000-0000-4000-8000-0000000a1003', 55, 50, 5, 0, '5 chai móp nhẹ, chờ kiểm tra', NULL),
  ('00000000-0000-4000-8000-0000000a8003', 2, '00000000-0000-4000-8000-0000000a1003', 55, 55, 0, 0, 'Đã kiểm tra, đạt yêu cầu', NULL),
  ('00000000-0000-4000-8000-0000000a8004', 1, '00000000-0000-4000-8000-0000000a1001', 25.000, 24.500, 0, 0.500, 'Bao bì rách, hao hụt 0,5 kg', NULL);

-- Reviews: D2 APPROVE by reviewer1; D3 rev1 APPROVE by reviewer1, rev2 APPROVE by reviewer2. D4 has none (awaiting a reviewer).
INSERT INTO receipt_review (id, receipt_id, delivery_id, count_revision, declaration_revision, reviewer_user_id, decision, reason, reviewed_at) VALUES
  ('00000000-0000-4000-8000-0000000ac001', '00000000-0000-4000-8000-0000000a8002', '00000000-0000-4000-8000-0000000a7002', 1, 1,
   '00000000-0000-4000-8000-000000000108', 'APPROVE', 'Chênh lệch khai báo 60 và đếm 58 đã được ghi nhận, 3 gói bị loại', now() - interval '5 days 16 hours'),
  ('00000000-0000-4000-8000-0000000ac002', '00000000-0000-4000-8000-0000000a8003', '00000000-0000-4000-8000-0000000a7003', 1, 1,
   '00000000-0000-4000-8000-000000000108', 'APPROVE', NULL, now() - interval '4 days 16 hours'),
  ('00000000-0000-4000-8000-0000000ac003', '00000000-0000-4000-8000-0000000a8003', '00000000-0000-4000-8000-0000000a7003', 2, 1,
   '00000000-0000-4000-8000-000000000109', 'APPROVE', 'Số lượng giữ lại đã được kiểm tra độc lập', now() - interval '2 days 20 hours');

-- Posting (stock changes only through the ledger; poster is the reviewer, never a counter).
INSERT INTO stock_movement (balance_id, movement_type, delta_on_hand, delta_reserved, receipt_id, operation_ref, actor_user_id, created_at) VALUES
  ('00000000-0000-4000-8000-0000000a5a02', 'RECEIPT', 55, 0, '00000000-0000-4000-8000-0000000a8002',
   'RCPT:00000000-0000-4000-8000-0000000a8002:00000000-0000-4000-8000-0000000a1002', '00000000-0000-4000-8000-000000000108', now() - interval '5 days 15 hours'),
  ('00000000-0000-4000-8000-0000000a5a03', 'RECEIPT', 50, 0, '00000000-0000-4000-8000-0000000a8003',
   'RCPT:00000000-0000-4000-8000-0000000a8003:00000000-0000-4000-8000-0000000a1003', '00000000-0000-4000-8000-000000000108', now() - interval '4 days 15 hours');
INSERT INTO stock_movement (balance_id, movement_type, delta_on_hand, delta_reserved, receipt_id, operation_ref, actor_user_id, created_at) VALUES
  ('00000000-0000-4000-8000-0000000a5a03', 'RECEIPT_HELD_RELEASE', 5, 0, '00000000-0000-4000-8000-0000000a8003',
   'HELD:00000000-0000-4000-8000-0000000a8003:2:00000000-0000-4000-8000-0000000a1003', '00000000-0000-4000-8000-000000000109', now() - interval '2 days 19 hours');

-- Delivery lifecycle (mutable table): D2 and D3 posted, D4 pending review, D1 stays DECLARED.
UPDATE donation_delivery SET status = 'POSTED'         WHERE id IN ('00000000-0000-4000-8000-0000000a7002', '00000000-0000-4000-8000-0000000a7003');
UPDATE donation_delivery SET status = 'PENDING_REVIEW' WHERE id = '00000000-0000-4000-8000-0000000a7004';

-- One OPEN dispute on D2 (opened by the donor through the capability secret; approval may proceed while it is open).
INSERT INTO donation_dispute (id, delivery_id, status, opened_by_kind, opened_by_user_id, reason, opened_at) VALUES
  ('00000000-0000-4000-8000-0000000a9001', '00000000-0000-4000-8000-0000000a7002', 'OPEN', 'DONOR', NULL,
   'Tôi bàn giao 60 gói nhưng biên nhận ghi đã đếm 58 gói, đề nghị đối chiếu lại.', now() - interval '5 days 10 hours');

-- ---------- fulfillment of the aid request (cycle OPEN, attribution copied from Response) ----------
INSERT INTO fulfillment_cycle (id, request_id, work_cycle, campaign_id, state, created_at) VALUES
  ('00000000-0000-4000-8000-0000000b7001', '00000000-0000-4000-8000-0000000000f5', 1,
   '00000000-0000-4000-8000-0000000000c1', 'OPEN', now() - interval '4 days');

-- N1: bộ sơ cứu 20 (12 delivered, 8 still reserved => outstanding 8). N2: nước đóng chai 30, 12 delivered, remaining 18 cancelled.
INSERT INTO relief_need (id, cycle_id, item_id, original_quantity, requested_quantity, cancelled_remaining, status, created_at) VALUES
  ('00000000-0000-4000-8000-0000000b1001', '00000000-0000-4000-8000-0000000b7001', '00000000-0000-4000-8000-0000000a1005', 20, 20, NULL, 'PARTIALLY_FULFILLED', now() - interval '4 days'),
  ('00000000-0000-4000-8000-0000000b1002', '00000000-0000-4000-8000-0000000b7001', '00000000-0000-4000-8000-0000000a1003', 30, 30, 18,   'CANCELLED',           now() - interval '4 days');

-- Commitments from warehouse A. C1 12 issued and delivered; C2 8 reserved only; C3 12 water issued and delivered.
-- Commitments are created only by supply requests; the leader of team a1 (...10c) requested both.
INSERT INTO commitment (id, relief_need_id, item_id, warehouse_id, quantity, released_quantity, issued_quantity, delivered_quantity, created_by_user_id, created_at) VALUES
  ('00000000-0000-4000-8000-0000000b2001', '00000000-0000-4000-8000-0000000b1001', '00000000-0000-4000-8000-0000000a1005', '00000000-0000-4000-8000-0000000a2001', 12, 0, 12, 12, '00000000-0000-4000-8000-00000000010c', now() - interval '200 minutes'),
  ('00000000-0000-4000-8000-0000000b2002', '00000000-0000-4000-8000-0000000b1001', '00000000-0000-4000-8000-0000000a1005', '00000000-0000-4000-8000-0000000a2001',  8, 0,  0,  0, '00000000-0000-4000-8000-00000000010c', now() - interval '60 minutes'),
  ('00000000-0000-4000-8000-0000000b2003', '00000000-0000-4000-8000-0000000b1002', '00000000-0000-4000-8000-0000000a1003', '00000000-0000-4000-8000-0000000a2001', 12, 0, 12, 12, '00000000-0000-4000-8000-00000000010c', now() - interval '200 minutes');

INSERT INTO stock_movement (balance_id, movement_type, delta_on_hand, delta_reserved, commitment_id, operation_ref, actor_user_id, created_at) VALUES
  ('00000000-0000-4000-8000-0000000a5a05', 'RESERVE', 0, 12, '00000000-0000-4000-8000-0000000b2001', 'COMMITMENT_RESERVE:00000000-0000-4000-8000-0000000b2001', '00000000-0000-4000-8000-00000000010c', now() - interval '200 minutes'),
  ('00000000-0000-4000-8000-0000000a5a05', 'RESERVE', 0,  8, '00000000-0000-4000-8000-0000000b2002', 'COMMITMENT_RESERVE:00000000-0000-4000-8000-0000000b2002', '00000000-0000-4000-8000-00000000010c', now() - interval '60 minutes'),
  ('00000000-0000-4000-8000-0000000a5a03', 'RESERVE', 0, 12, '00000000-0000-4000-8000-0000000b2003', 'COMMITMENT_RESERVE:00000000-0000-4000-8000-0000000b2003', '00000000-0000-4000-8000-00000000010c', now() - interval '200 minutes');

-- Supply request S1 (handed over): the team asked for 12 bộ sơ cứu and 12 nước; ops_mgr handed them over against the code,
-- which issued the goods and counted them as delivered to the SOS needs.
INSERT INTO supply_request (id, mission_id, request_id, work_cycle, campaign_id, team_id, team_name, warehouse_id, status, pickup_code,
                            requested_by, on_behalf, expires_at, handed_over_by, handed_over_at, version, created_at, updated_at) VALUES
  ('00000000-0000-4000-8000-0000000b3001', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000f5', 1,
   '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'Đội xuồng cứu hộ 1', '00000000-0000-4000-8000-0000000a2001',
   'HANDED_OVER', '318204', '00000000-0000-4000-8000-00000000010c', false, now() + interval '2 hours',
   '00000000-0000-4000-8000-000000000105', now() - interval '190 minutes', 2, now() - interval '200 minutes', now() - interval '190 minutes');
INSERT INTO supply_request_line (supply_request_id, item_id, relief_need_id, commitment_id, requested_quantity, reserved_quantity) VALUES
  ('00000000-0000-4000-8000-0000000b3001', '00000000-0000-4000-8000-0000000a1005', '00000000-0000-4000-8000-0000000b1001', '00000000-0000-4000-8000-0000000b2001', 12, 12),
  ('00000000-0000-4000-8000-0000000b3001', '00000000-0000-4000-8000-0000000a1003', '00000000-0000-4000-8000-0000000b1002', '00000000-0000-4000-8000-0000000b2003', 12, 12);
INSERT INTO stock_movement (balance_id, movement_type, delta_on_hand, delta_reserved, commitment_id, operation_ref, actor_user_id, created_at) VALUES
  ('00000000-0000-4000-8000-0000000a5a05', 'ISSUE', -12, -12, '00000000-0000-4000-8000-0000000b2001', 'SUPPLY_ISSUE:00000000-0000-4000-8000-0000000b3001:00000000-0000-4000-8000-0000000b2001', '00000000-0000-4000-8000-000000000105', now() - interval '190 minutes'),
  ('00000000-0000-4000-8000-0000000a5a03', 'ISSUE', -12, -12, '00000000-0000-4000-8000-0000000b2003', 'SUPPLY_ISSUE:00000000-0000-4000-8000-0000000b3001:00000000-0000-4000-8000-0000000b2003', '00000000-0000-4000-8000-000000000105', now() - interval '190 minutes');

-- Supply request S2 (waiting at the warehouse): the remaining 8 bộ sơ cứu are reserved. Demo: log in as ops_mgr,
-- open "Giao hàng cho đội" and hand it over with code 527913 (the leader sees the same code on the mission).
INSERT INTO supply_request (id, mission_id, request_id, work_cycle, campaign_id, team_id, team_name, warehouse_id, status, pickup_code,
                            requested_by, on_behalf, expires_at, version, created_at, updated_at) VALUES
  ('00000000-0000-4000-8000-0000000b3002', '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000f5', 1,
   '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'Đội xuồng cứu hộ 1', '00000000-0000-4000-8000-0000000a2001',
   'READY', '527913', '00000000-0000-4000-8000-00000000010c', false, now() + interval '3 days', 1, now() - interval '60 minutes', now() - interval '60 minutes');
INSERT INTO supply_request_line (supply_request_id, item_id, relief_need_id, commitment_id, requested_quantity, reserved_quantity) VALUES
  ('00000000-0000-4000-8000-0000000b3002', '00000000-0000-4000-8000-0000000a1005', '00000000-0000-4000-8000-0000000b1001', '00000000-0000-4000-8000-0000000b2002', 8, 8);

-- ---------- pending stock adjustment (requested by ops_seed; awaiting ops_mgr or a reviewer) ----------
INSERT INTO stock_adjustment (id, balance_id, delta_on_hand, reason, status, requested_by_user_id, requested_at) VALUES
  ('00000000-0000-4000-8000-0000000b8001', '00000000-0000-4000-8000-0000000a5a02', -3,
   'Kiểm kê phát hiện 3 gói mì bị ẩm mốc cần loại bỏ', 'PENDING', '00000000-0000-4000-8000-000000000112', now() - interval '1 hour');

-- ---------- notices for ops_mgr ----------
INSERT INTO notice (id, recipient_user_id, source_id, source_version, notice_type, payload, created_at) VALUES
  ('00000000-0000-4000-8000-0000000d1001', '00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-0000000b8001', 1, 'STOCK_ADJUSTMENT_PENDING',
   '{"title": "Có yêu cầu điều chỉnh tồn kho chờ duyệt", "message": "Kho trung tâm A: giảm 3 gói Mì gói do ẩm mốc."}'::jsonb, now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000d1003', '00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-0000000a7004', 1, 'DONATION_PENDING_REVIEW',
   '{"title": "Có phiếu tiếp nhận chờ duyệt", "message": "Phiếu GD7K2M04 đã được kiểm đếm và đang chờ người duyệt độc lập."}'::jsonb, now() - interval '2 hours'),
  ('00000000-0000-4000-8000-0000000d1004', '00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-0000000a9001', 1, 'DONATION_DISPUTE_OPENED',
   '{"title": "Có khiếu nại về số lượng tiếp nhận", "message": "Người quyên góp phiếu GD7K2M02 đề nghị đối chiếu lại số lượng đã đếm."}'::jsonb, now() - interval '5 days 10 hours');

-- @include demo expansion

-- ---------- assertions (any mismatch aborts the load) ----------
DO $$
DECLARE n int; v numeric;
BEGIN
  -- every balance equals the sum of its movements (zero for balances without movements)
  SELECT count(*) INTO n FROM stock_balance b
   WHERE b.on_hand  <> coalesce((SELECT sum(m.delta_on_hand)  FROM stock_movement m WHERE m.balance_id = b.id), 0)
      OR b.reserved <> coalesce((SELECT sum(m.delta_reserved) FROM stock_movement m WHERE m.balance_id = b.id), 0);
  IF n <> 0 THEN RAISE EXCEPTION 'seed assertion failed: % stock balances differ from the ledger sum', n; END IF;

  -- every hand-over issues and delivers in one step: delivered = issued = the ISSUE movements of the commitment
  IF EXISTS (SELECT 1 FROM commitment c
              WHERE c.delivered_quantity <> c.issued_quantity
                 OR c.issued_quantity <> coalesce((SELECT -sum(m.delta_on_hand) FROM stock_movement m
                                                    WHERE m.commitment_id = c.id AND m.movement_type = 'ISSUE'), 0)) THEN
    RAISE EXCEPTION 'seed assertion failed: commitment counters differ from the ISSUE movements';
  END IF;
  IF EXISTS (SELECT 1 FROM check_cycle_state_matches_intent()) THEN
    RAISE EXCEPTION 'seed assertion failed: check_cycle_state_matches_intent() returned rows';
  END IF;

  -- D2: accepted total in the ledger is 55
  SELECT coalesce(sum(delta_on_hand), 0) INTO v FROM stock_movement
   WHERE receipt_id = '00000000-0000-4000-8000-0000000a8002' AND movement_type IN ('RECEIPT', 'RECEIPT_HELD_RELEASE');
  IF v <> 55 THEN RAISE EXCEPTION 'seed assertion failed: D2 ledger accepted total is %, expected 55', v; END IF;

  -- D3: 50 posted then 5 released
  SELECT coalesce(sum(delta_on_hand), 0) INTO v FROM stock_movement
   WHERE receipt_id = '00000000-0000-4000-8000-0000000a8003' AND movement_type IN ('RECEIPT', 'RECEIPT_HELD_RELEASE');
  IF v <> 55 THEN RAISE EXCEPTION 'seed assertion failed: D3 ledger accepted total is %, expected 55', v; END IF;

  -- need N1: outstanding = requested - delivered = 8
  SELECT n1.requested_quantity - coalesce((SELECT sum(c.delivered_quantity) FROM commitment c WHERE c.relief_need_id = n1.id), 0)
    INTO v FROM relief_need n1 WHERE n1.id = '00000000-0000-4000-8000-0000000b1001';
  IF v <> 8 THEN RAISE EXCEPTION 'seed assertion failed: need N1 outstanding is %, expected 8', v; END IF;

  -- N1 still holds exactly 8 reserved and unissued (commitment C2) and N2 cancelled_remaining = requested - delivered
  SELECT coalesce(sum(quantity - released_quantity - issued_quantity), 0) INTO v FROM commitment WHERE relief_need_id = '00000000-0000-4000-8000-0000000b1001';
  IF v <> 8 THEN RAISE EXCEPTION 'seed assertion failed: N1 reserved remaining is %, expected 8', v; END IF;
  SELECT n2.requested_quantity - n2.cancelled_remaining - coalesce(sum(c.delivered_quantity), 0) INTO v
    FROM relief_need n2 LEFT JOIN commitment c ON c.relief_need_id = n2.id WHERE n2.id = '00000000-0000-4000-8000-0000000b1002' GROUP BY n2.id;
  IF v <> 0 THEN RAISE EXCEPTION 'seed assertion failed: N2 cancelled_remaining does not equal requested - delivered'; END IF;

  -- one open supply request per mission, holding exactly the 8 reserved bộ sơ cứu
  SELECT count(*) INTO n FROM supply_request WHERE mission_id = '00000000-0000-4000-8000-0000000000b1' AND status = 'READY';
  IF n <> 1 THEN RAISE EXCEPTION 'seed assertion failed: expected one READY supply request for the demo mission'; END IF;
END $$;

COMMIT;
