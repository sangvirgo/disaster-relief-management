-- C48 Logistics service: synthetic demo seed (docs/backend/00-setup.md "Seed files"; plan section 17 demonstration).
-- Loads into a freshly created database that already holds schema/logistics.sql:
--   psql -v ON_ERROR_STOP=1 -f schema/logistics.sql -f seed/seed-logistics.sql
-- All data is synthetic: no real people, phones are 0900000xxx, hashes are placeholders. Stock is created only by stock_movement inserts
-- (the apply_stock_movement trigger updates balances); balances are pre-inserted at zero. No trigger is disabled.
-- Cross-service ids (fixed, shared with seed-identity.sql / seed-response.sql):
--   ORG_COORD 00000000-0000-4000-8000-000000000001   CAMPAIGN_ACTIVE ...0000000000c1   REQUEST_AID ...0000000000f5 (work_cycle 1, region DEMO_A)
--   users: coord1 ...102, campaign_mgr ...104, ops_mgr ...105, intake1 ...106, intake2 ...107, reviewer1 ...108, reviewer2 ...109,
--          dist1 ...10a, dist2 ...10b, vol_leader1 ...10c
-- Local ids use the prefix 00000000-0000-4000-8000-0000000 + a 5-hex suffix (a1xxx items, a2xxx warehouses, a3xxx points, a4xxx vehicles,
-- a5xxx balances, a6xxx drives, a7xxx deliveries, a8xxx receipts, a9xxx disputes, b1xxx needs, b2xxx commitments, b3xxx distributions,
-- b4xxx distribution lines, b5xxx handoffs, b6xxx handoff lines, b7xxx cycle, b8xxx adjustment).
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

INSERT INTO item (id, item_type_code, unit_code, name) VALUES
  ('00000000-0000-4000-8000-0000000a1001', 'LUONG_THUC', 'KG',    'Gạo'),
  ('00000000-0000-4000-8000-0000000a1002', 'LUONG_THUC', 'CAI',   'Mì gói'),
  ('00000000-0000-4000-8000-0000000a1003', 'NUOC_UONG',  'CAI',   'Nước đóng chai'),
  ('00000000-0000-4000-8000-0000000a1004', 'NUOC_UONG',  'LIT',   'Nước sạch đóng can'),
  ('00000000-0000-4000-8000-0000000a1005', 'Y_TE',       'CAI',   'Bộ sơ cứu'),
  ('00000000-0000-4000-8000-0000000a1006', 'Y_TE',       'THUNG', 'Băng gạc y tế'),
  ('00000000-0000-4000-8000-0000000a1007', 'CHAN_MEN',   'CAI',   'Chăn'),
  ('00000000-0000-4000-8000-0000000a1008', 'CHAN_MEN',   'CAI',   'Màn chống muỗi');

-- ---------- assets ----------
INSERT INTO warehouse (id, organization_id, region_code, name, address_note, location, location_public) VALUES
  ('00000000-0000-4000-8000-0000000a2001', '00000000-0000-4000-8000-000000000001', 'DEMO_A', 'Kho trung tâm Demo A',
   'Số 10 đường Mẫu, khu vực Demo A (dữ liệu giả lập)', ST_GeogFromText('SRID=4326;POINT(106.6300 10.8200)'), true),
  ('00000000-0000-4000-8000-0000000a2002', '00000000-0000-4000-8000-000000000001', 'DEMO_B', 'Kho khu vực Demo B',
   'Số 25 đường Thử nghiệm, khu vực Demo B (dữ liệu giả lập)', ST_GeogFromText('SRID=4326;POINT(108.2000 16.0700)'), false);

INSERT INTO relief_point (id, organization_id, region_code, name, contact_note, operating_note, location, status) VALUES
  ('00000000-0000-4000-8000-0000000a3001', '00000000-0000-4000-8000-000000000001', 'DEMO_A', 'Điểm cứu trợ Trường tiểu học Mẫu',
   'Liên hệ qua điều phối viên, số giả lập 0900000201', 'Mở cửa 07:00 đến 19:00', ST_GeogFromText('SRID=4326;POINT(106.6450 10.8300)'), 'ACTIVE'),
  ('00000000-0000-4000-8000-0000000a3002', '00000000-0000-4000-8000-000000000001', 'DEMO_B', 'Điểm cứu trợ Nhà văn hóa Thử nghiệm',
   'Liên hệ qua điều phối viên, số giả lập 0900000202', 'Mở cửa 08:00 đến 18:00', ST_GeogFromText('SRID=4326;POINT(108.2100 16.0600)'), 'ACTIVE'),
  ('00000000-0000-4000-8000-0000000a3003', '00000000-0000-4000-8000-000000000001', 'DEMO_A', 'Điểm cứu trợ cũ (đã ngừng hoạt động)',
   NULL, 'Tạm đóng do ngập sâu', ST_GeogFromText('SRID=4326;POINT(106.6100 10.8100)'), 'INACTIVE');

INSERT INTO vehicle (id, organization_id, region_code, identifier, vehicle_type, capacity, capacity_unit) VALUES
  ('00000000-0000-4000-8000-0000000a4001', '00000000-0000-4000-8000-000000000001', 'DEMO_A', '51D-000.01', 'Xe tải 1,5 tấn', 1500.000, 'KG'),
  ('00000000-0000-4000-8000-0000000a4002', '00000000-0000-4000-8000-000000000001', 'DEMO_B', '43C-000.02', 'Xe bán tải', NULL, NULL);

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
INSERT INTO donation_drive (id, campaign_id, campaign_status, campaign_status_at, organization_id, intake_warehouse_id, title, description, status, opens_at, closes_at, created_at) VALUES
  ('00000000-0000-4000-8000-0000000a6001', '00000000-0000-4000-8000-0000000000c1', 'ACTIVE', now() - interval '1 minute',
   '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000a2001',
   'Quyên góp nhu yếu phẩm cho vùng ngập Demo A', 'Tiếp nhận lương thực, nước uống và chăn màn tại kho trung tâm Demo A. Dữ liệu giả lập phục vụ trình diễn.',
   'OPEN', now() - interval '9 days', now() + interval '20 days', now() - interval '9 days'),
  ('00000000-0000-4000-8000-0000000a6002', '00000000-0000-4000-8000-0000000000c1', 'ACTIVE', now() - interval '1 minute',
   '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000a2002',
   'Quyên góp vật tư y tế đợt 2 (bản nháp)', 'Bản nháp chưa công bố: vật tư y tế cho kho Demo B.',
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
INSERT INTO donation_delivery (id, public_code, drive_id, organization_id, donor_name, donor_phone, capability_hash, status, created_at) VALUES
  ('00000000-0000-4000-8000-0000000a7001', 'GD7K2M01', '00000000-0000-4000-8000-0000000a6001', '00000000-0000-4000-8000-000000000001',
   'Nhà hảo tâm giả lập 01', '0900000001', 'demo-capability-hash-0001', 'DECLARED', now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000a7002', 'GD7K2M02', '00000000-0000-4000-8000-0000000a6001', '00000000-0000-4000-8000-000000000001',
   'Nhà hảo tâm giả lập 02', '0900000002', 'demo-capability-hash-0002', 'DECLARED', now() - interval '6 days'),
  ('00000000-0000-4000-8000-0000000a7003', 'GD7K2M03', '00000000-0000-4000-8000-0000000a6001', '00000000-0000-4000-8000-000000000001',
   'Nhà hảo tâm giả lập 03', '0900000003', 'demo-capability-hash-0003', 'DECLARED', now() - interval '5 days'),
  ('00000000-0000-4000-8000-0000000a7004', 'GD7K2M04', '00000000-0000-4000-8000-0000000a6001', '00000000-0000-4000-8000-000000000001',
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

-- Counts. D2 rev1 by intake1; D3 rev1 by intake1 and rev2 (held released) by intake2; D4 rev1 by intake2 (pending, not reviewed).
INSERT INTO receipt_count (receipt_id, revision, counted_by_user_id, counted_at, note) VALUES
  ('00000000-0000-4000-8000-0000000a8002', 1, '00000000-0000-4000-8000-000000000106', now() - interval '5 days 18 hours', 'Đếm 58 gói, 3 gói rách bao bì bị loại'),
  ('00000000-0000-4000-8000-0000000a8003', 1, '00000000-0000-4000-8000-000000000106', now() - interval '4 days 18 hours', 'Giữ lại 5 chai chờ kiểm tra hạn dùng'),
  ('00000000-0000-4000-8000-0000000a8003', 2, '00000000-0000-4000-8000-000000000107', now() - interval '3 days',          'Kiểm tra lại: 5 chai còn hạn, chuyển sang chấp nhận'),
  ('00000000-0000-4000-8000-0000000a8004', 1, '00000000-0000-4000-8000-000000000107', now() - interval '2 hours',          'Đã cân và đếm xong, chờ người duyệt độc lập');

INSERT INTO receipt_count_line (receipt_id, revision, item_id, counted_quantity, accepted_quantity, held_quantity, rejected_quantity, condition_note, expiry_date) VALUES
  ('00000000-0000-4000-8000-0000000a8002', 1, '00000000-0000-4000-8000-0000000a1002', 58, 55, 0, 3, '3 gói rách bao bì', current_date + 120),
  ('00000000-0000-4000-8000-0000000a8003', 1, '00000000-0000-4000-8000-0000000a1003', 55, 50, 5, 0, '5 chai móp nhẹ, chờ kiểm tra', NULL),
  ('00000000-0000-4000-8000-0000000a8003', 2, '00000000-0000-4000-8000-0000000a1003', 55, 55, 0, 0, 'Đã kiểm tra, đạt yêu cầu', NULL),
  ('00000000-0000-4000-8000-0000000a8004', 1, '00000000-0000-4000-8000-0000000a1001', 25.000, 24.500, 0, 0.500, 'Bao bì rách, hao hụt 0,5 kg', NULL);

-- Reviews: D2 APPROVE by reviewer1; D3 rev1 APPROVE by reviewer1, rev2 APPROVE by reviewer2. D4 has none (awaiting a reviewer other than intake2).
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
INSERT INTO fulfillment_cycle (id, request_id, work_cycle, organization_id, campaign_id, region_code, state, created_at) VALUES
  ('00000000-0000-4000-8000-0000000b7001', '00000000-0000-4000-8000-0000000000f5', 1, '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-0000000000c1', 'DEMO_A', 'OPEN', now() - interval '4 days');

-- N1: bộ sơ cứu 20 (12 delivered, 8 still reserved => outstanding 8). N2: nước đóng chai 30, 12 delivered, remaining 18 cancelled.
INSERT INTO relief_need (id, cycle_id, item_id, original_quantity, requested_quantity, cancelled_remaining, status, created_at) VALUES
  ('00000000-0000-4000-8000-0000000b1001', '00000000-0000-4000-8000-0000000b7001', '00000000-0000-4000-8000-0000000a1005', 20, 20, NULL, 'PARTIALLY_FULFILLED', now() - interval '4 days'),
  ('00000000-0000-4000-8000-0000000b1002', '00000000-0000-4000-8000-0000000b7001', '00000000-0000-4000-8000-0000000a1003', 30, 30, 18,   'CANCELLED',           now() - interval '4 days');

-- Commitments from warehouse A. C1 12 issued and delivered; C2 8 reserved only; C3 12 water issued and delivered.
INSERT INTO commitment (id, relief_need_id, item_id, warehouse_id, quantity, released_quantity, issued_quantity, delivered_quantity, returned_quantity, lost_quantity, created_by_user_id, created_at) VALUES
  ('00000000-0000-4000-8000-0000000b2001', '00000000-0000-4000-8000-0000000b1001', '00000000-0000-4000-8000-0000000a1005', '00000000-0000-4000-8000-0000000a2001', 12, 0, 12, 12, 0, 0, '00000000-0000-4000-8000-000000000105', now() - interval '4 days'),
  ('00000000-0000-4000-8000-0000000b2002', '00000000-0000-4000-8000-0000000b1001', '00000000-0000-4000-8000-0000000a1005', '00000000-0000-4000-8000-0000000a2001',  8, 0,  0,  0, 0, 0, '00000000-0000-4000-8000-000000000105', now() - interval '3 days'),
  ('00000000-0000-4000-8000-0000000b2003', '00000000-0000-4000-8000-0000000b1002', '00000000-0000-4000-8000-0000000a1003', '00000000-0000-4000-8000-0000000a2001', 12, 0, 12, 12, 0, 0, '00000000-0000-4000-8000-000000000105', now() - interval '4 days');

INSERT INTO stock_movement (balance_id, movement_type, delta_on_hand, delta_reserved, commitment_id, operation_ref, actor_user_id, created_at) VALUES
  ('00000000-0000-4000-8000-0000000a5a05', 'RESERVE', 0, 12, '00000000-0000-4000-8000-0000000b2001', 'RESERVE:00000000-0000-4000-8000-0000000b2001', '00000000-0000-4000-8000-000000000105', now() - interval '4 days'),
  ('00000000-0000-4000-8000-0000000a5a05', 'RESERVE', 0,  8, '00000000-0000-4000-8000-0000000b2002', 'RESERVE:00000000-0000-4000-8000-0000000b2002', '00000000-0000-4000-8000-000000000105', now() - interval '3 days'),
  ('00000000-0000-4000-8000-0000000a5a03', 'RESERVE', 0, 12, '00000000-0000-4000-8000-0000000b2003', 'RESERVE:00000000-0000-4000-8000-0000000b2003', '00000000-0000-4000-8000-000000000105', now() - interval '4 days');

-- Distribution 1 (REQUEST_AID, direct to a household): preparer dist1, approver ops_mgr, dispatcher dist2, recorder vol_leader1.
INSERT INTO distribution (id, warehouse_id, organization_id, vehicle_id, campaign_id, purpose, status, preparer_user_id, created_at) VALUES
  ('00000000-0000-4000-8000-0000000b3001', '00000000-0000-4000-8000-0000000a2001', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-0000000a4001', '00000000-0000-4000-8000-0000000000c1', 'REQUEST_AID', 'DRAFT',
   '00000000-0000-4000-8000-00000000010a', now() - interval '3 days 20 hours');
INSERT INTO distribution_line (id, distribution_id, warehouse_id, item_id, commitment_id, quantity) VALUES
  ('00000000-0000-4000-8000-0000000b4001', '00000000-0000-4000-8000-0000000b3001', '00000000-0000-4000-8000-0000000a2001', '00000000-0000-4000-8000-0000000a1005', '00000000-0000-4000-8000-0000000b2001', 12),
  ('00000000-0000-4000-8000-0000000b4002', '00000000-0000-4000-8000-0000000b3001', '00000000-0000-4000-8000-0000000a2001', '00000000-0000-4000-8000-0000000a1003', '00000000-0000-4000-8000-0000000b2003', 12);
UPDATE distribution SET status = 'RECONCILED',
  approver_user_id = '00000000-0000-4000-8000-000000000105', approved_version = version, approved_at = now() - interval '3 days 19 hours',
  dispatch_actor_user_id = '00000000-0000-4000-8000-00000000010b', dispatched_at = now() - interval '3 days 18 hours',
  reconciled_at = now() - interval '3 days 16 hours'
WHERE id = '00000000-0000-4000-8000-0000000b3001';

INSERT INTO stock_movement (balance_id, movement_type, delta_on_hand, delta_reserved, commitment_id, operation_ref, actor_user_id, created_at) VALUES
  ('00000000-0000-4000-8000-0000000a5a05', 'ISSUE', -12, -12, '00000000-0000-4000-8000-0000000b2001', 'ISSUE:00000000-0000-4000-8000-0000000b4001', '00000000-0000-4000-8000-00000000010b', now() - interval '3 days 18 hours'),
  ('00000000-0000-4000-8000-0000000a5a03', 'ISSUE', -12, -12, '00000000-0000-4000-8000-0000000b2003', 'ISSUE:00000000-0000-4000-8000-0000000b4002', '00000000-0000-4000-8000-00000000010b', now() - interval '3 days 18 hours');

INSERT INTO handoff_record (id, distribution_id, handoff_kind, receiver_label, recorder_user_id, confirmation_basis, occurred_at, created_at) VALUES
  ('00000000-0000-4000-8000-0000000b5001', '00000000-0000-4000-8000-0000000b3001', 'DIRECT_HOUSEHOLD', 'Hộ gia đình giả lập, tổ 5 khu vực Demo A',
   '00000000-0000-4000-8000-00000000010c', 'Chủ hộ ký nhận trên phiếu giao', now() - interval '3 days 17 hours', now() - interval '3 days 17 hours');
INSERT INTO handoff_line (id, handoff_id, distribution_id, distribution_line_id, commitment_id, quantity) VALUES
  ('00000000-0000-4000-8000-0000000b6001', '00000000-0000-4000-8000-0000000b5001', '00000000-0000-4000-8000-0000000b3001', '00000000-0000-4000-8000-0000000b4001', '00000000-0000-4000-8000-0000000b2001', 12),
  ('00000000-0000-4000-8000-0000000b6002', '00000000-0000-4000-8000-0000000b5001', '00000000-0000-4000-8000-0000000b3001', '00000000-0000-4000-8000-0000000b4002', '00000000-0000-4000-8000-0000000b2003', 12);
INSERT INTO issued_line_settlement (handoff_line_id, commitment_id, settlement_type, created_at) VALUES
  ('00000000-0000-4000-8000-0000000b6001', '00000000-0000-4000-8000-0000000b2001', 'DELIVERED', now() - interval '3 days 17 hours'),
  ('00000000-0000-4000-8000-0000000b6002', '00000000-0000-4000-8000-0000000b2003', 'DELIVERED', now() - interval '3 days 17 hours');

-- Distribution 2 (plan TC-DIST-02): issue 55 mì gói to a relief point; point receipt 50, loss 5 pending (no loss review row),
-- handout 35 => 15 held at the point; the 5 under pending loss stay in transit (excluded from custody arithmetic until reviewed).
INSERT INTO distribution (id, warehouse_id, organization_id, relief_point_id, vehicle_id, campaign_id, purpose, status, preparer_user_id, created_at) VALUES
  ('00000000-0000-4000-8000-0000000b3002', '00000000-0000-4000-8000-0000000a2001', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-0000000a3001', '00000000-0000-4000-8000-0000000a4001', '00000000-0000-4000-8000-0000000000c1', 'POINT_REPLENISHMENT', 'DRAFT',
   '00000000-0000-4000-8000-00000000010a', now() - interval '2 days 20 hours');
INSERT INTO distribution_line (id, distribution_id, warehouse_id, item_id, quantity, in_transit_quantity, at_point_quantity) VALUES
  ('00000000-0000-4000-8000-0000000b4003', '00000000-0000-4000-8000-0000000b3002', '00000000-0000-4000-8000-0000000a2001', '00000000-0000-4000-8000-0000000a1002', 55, 5, 15);
UPDATE distribution SET status = 'DISPATCHED',
  approver_user_id = '00000000-0000-4000-8000-000000000105', approved_version = version, approved_at = now() - interval '2 days 19 hours',
  dispatch_actor_user_id = '00000000-0000-4000-8000-00000000010b', dispatched_at = now() - interval '2 days 18 hours'
WHERE id = '00000000-0000-4000-8000-0000000b3002';

INSERT INTO stock_movement (balance_id, movement_type, delta_on_hand, delta_reserved, distribution_line_id, operation_ref, actor_user_id, created_at) VALUES
  ('00000000-0000-4000-8000-0000000a5a02', 'RESERVE', 0, 55, '00000000-0000-4000-8000-0000000b4003', 'RESERVE:DL:00000000-0000-4000-8000-0000000b4003', '00000000-0000-4000-8000-00000000010b', now() - interval '2 days 18 hours');
INSERT INTO stock_movement (balance_id, movement_type, delta_on_hand, delta_reserved, distribution_line_id, operation_ref, actor_user_id, created_at) VALUES
  ('00000000-0000-4000-8000-0000000a5a02', 'ISSUE', -55, -55, '00000000-0000-4000-8000-0000000b4003', 'ISSUE:DL:00000000-0000-4000-8000-0000000b4003', '00000000-0000-4000-8000-00000000010b', now() - interval '2 days 18 hours');

INSERT INTO handoff_record (id, distribution_id, handoff_kind, source_stage, receiver_label, recorder_user_id, confirmation_basis, occurred_at, created_at) VALUES
  ('00000000-0000-4000-8000-0000000b5002', '00000000-0000-4000-8000-0000000b3002', 'POINT_RECEIPT',    NULL,         'Điểm cứu trợ Trường tiểu học Mẫu',
   '00000000-0000-4000-8000-00000000010a', 'Trưởng điểm ký nhận 50 gói, ghi chú thiếu 5 gói', now() - interval '2 days 12 hours', now() - interval '2 days 12 hours'),
  ('00000000-0000-4000-8000-0000000b5003', '00000000-0000-4000-8000-0000000b3002', 'HOUSEHOLD_HANDOUT', NULL,         'Danh sách 35 hộ nhận tại điểm (giả lập)',
   '00000000-0000-4000-8000-00000000010c', 'Sổ phát có chữ ký từng hộ', now() - interval '2 days', now() - interval '2 days'),
  ('00000000-0000-4000-8000-0000000b5004', '00000000-0000-4000-8000-0000000b3002', 'LOSS',              'IN_TRANSIT', NULL,
   '00000000-0000-4000-8000-00000000010c', 'Biên bản thiếu 5 gói khi vận chuyển, chờ xác minh độc lập', now() - interval '2 days 11 hours', now() - interval '2 days 11 hours');
INSERT INTO handoff_line (id, handoff_id, distribution_id, distribution_line_id, quantity) VALUES
  ('00000000-0000-4000-8000-0000000b6003', '00000000-0000-4000-8000-0000000b5002', '00000000-0000-4000-8000-0000000b3002', '00000000-0000-4000-8000-0000000b4003', 50),
  ('00000000-0000-4000-8000-0000000b6004', '00000000-0000-4000-8000-0000000b5003', '00000000-0000-4000-8000-0000000b3002', '00000000-0000-4000-8000-0000000b4003', 35),
  ('00000000-0000-4000-8000-0000000b6005', '00000000-0000-4000-8000-0000000b5004', '00000000-0000-4000-8000-0000000b3002', '00000000-0000-4000-8000-0000000b4003', 5);

-- Distribution 3: CAMPAIGN_DISTRIBUTION still DRAFT (warehouse B, no commitment, no stock effect yet).
INSERT INTO distribution (id, warehouse_id, organization_id, campaign_id, purpose, status, preparer_user_id, created_at) VALUES
  ('00000000-0000-4000-8000-0000000b3003', '00000000-0000-4000-8000-0000000a2002', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-0000000000c1', 'CAMPAIGN_DISTRIBUTION', 'DRAFT', '00000000-0000-4000-8000-00000000010b', now() - interval '2 hours');
INSERT INTO distribution_line (id, distribution_id, warehouse_id, item_id, quantity) VALUES
  ('00000000-0000-4000-8000-0000000b4004', '00000000-0000-4000-8000-0000000b3003', '00000000-0000-4000-8000-0000000a2002', '00000000-0000-4000-8000-0000000a1001', 40.000),
  ('00000000-0000-4000-8000-0000000b4005', '00000000-0000-4000-8000-0000000b3003', '00000000-0000-4000-8000-0000000a2002', '00000000-0000-4000-8000-0000000a1007', 20);

-- ---------- pending stock adjustment (requested by intake1; awaiting ops_mgr or a reviewer) ----------
INSERT INTO stock_adjustment (id, balance_id, delta_on_hand, reason, status, requested_by_user_id, requested_at) VALUES
  ('00000000-0000-4000-8000-0000000b8001', '00000000-0000-4000-8000-0000000a5a02', -3,
   'Kiểm kê phát hiện 3 gói mì bị ẩm mốc cần loại bỏ', 'PENDING', '00000000-0000-4000-8000-000000000106', now() - interval '1 hour');

-- ---------- notices for ops_mgr ----------
INSERT INTO notice (id, recipient_user_id, source_id, source_version, notice_type, payload, created_at) VALUES
  ('00000000-0000-4000-8000-0000000d1001', '00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-0000000b8001', 1, 'STOCK_ADJUSTMENT_PENDING',
   '{"title": "Có yêu cầu điều chỉnh tồn kho chờ duyệt", "message": "Kho trung tâm Demo A: giảm 3 gói Mì gói do ẩm mốc."}'::jsonb, now() - interval '1 hour'),
  ('00000000-0000-4000-8000-0000000d1002', '00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-0000000b5004', 1, 'LOSS_REVIEW_PENDING',
   '{"title": "Có biên bản thất thoát chờ xác minh", "message": "Phiếu phân phối tại Điểm cứu trợ Trường tiểu học Mẫu ghi thiếu 5 gói Mì gói."}'::jsonb, now() - interval '2 days 11 hours'),
  ('00000000-0000-4000-8000-0000000d1003', '00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-0000000a7004', 1, 'DONATION_PENDING_REVIEW',
   '{"title": "Có phiếu tiếp nhận chờ duyệt", "message": "Phiếu GD7K2M04 đã được kiểm đếm và đang chờ người duyệt độc lập."}'::jsonb, now() - interval '2 hours'),
  ('00000000-0000-4000-8000-0000000d1004', '00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-0000000a9001', 1, 'DONATION_DISPUTE_OPENED',
   '{"title": "Có khiếu nại về số lượng tiếp nhận", "message": "Người quyên góp phiếu GD7K2M02 đề nghị đối chiếu lại số lượng đã đếm."}'::jsonb, now() - interval '5 days 10 hours');

-- ---------- assertions (any mismatch aborts the load) ----------
DO $$
DECLARE n int; v numeric;
BEGIN
  -- every balance equals the sum of its movements (zero for balances without movements)
  SELECT count(*) INTO n FROM stock_balance b
   WHERE b.on_hand  <> coalesce((SELECT sum(m.delta_on_hand)  FROM stock_movement m WHERE m.balance_id = b.id), 0)
      OR b.reserved <> coalesce((SELECT sum(m.delta_reserved) FROM stock_movement m WHERE m.balance_id = b.id), 0);
  IF n <> 0 THEN RAISE EXCEPTION 'seed assertion failed: % stock balances differ from the ledger sum', n; END IF;

  IF EXISTS (SELECT 1 FROM commitment_counter_mismatch) THEN
    RAISE EXCEPTION 'seed assertion failed: commitment_counter_mismatch returned rows';
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

  -- need N1: outstanding = requested - delivered = 8, delivered derived from settlements
  SELECT n1.requested_quantity - coalesce((SELECT sum(h.quantity) FROM issued_line_settlement s JOIN commitment c ON c.id = s.commitment_id
                                           JOIN handoff_line h ON h.id = s.handoff_line_id
                                           WHERE c.relief_need_id = n1.id AND s.settlement_type = 'DELIVERED'), 0)
    INTO v FROM relief_need n1 WHERE n1.id = '00000000-0000-4000-8000-0000000b1001';
  IF v <> 8 THEN RAISE EXCEPTION 'seed assertion failed: need N1 outstanding is %, expected 8', v; END IF;

  -- N1 still holds exactly 8 reserved and unissued (commitment C2) and N2 cancelled_remaining = requested - delivered
  SELECT coalesce(sum(quantity - released_quantity - issued_quantity), 0) INTO v FROM commitment WHERE relief_need_id = '00000000-0000-4000-8000-0000000b1001';
  IF v <> 8 THEN RAISE EXCEPTION 'seed assertion failed: N1 reserved remaining is %, expected 8', v; END IF;
  SELECT n2.requested_quantity - n2.cancelled_remaining - coalesce(sum(c.delivered_quantity), 0) INTO v
    FROM relief_need n2 LEFT JOIN commitment c ON c.relief_need_id = n2.id WHERE n2.id = '00000000-0000-4000-8000-0000000b1002' GROUP BY n2.id;
  IF v <> 0 THEN RAISE EXCEPTION 'seed assertion failed: N2 cancelled_remaining does not equal requested - delivered'; END IF;

  -- point distribution counters: 50 received, 35 handed out, 15 at the point, 5 pending loss still in transit
  SELECT count(*) INTO n FROM distribution_line l WHERE l.id = '00000000-0000-4000-8000-0000000b4003' AND l.at_point_quantity = 15 AND l.in_transit_quantity = 5;
  IF n <> 1 THEN RAISE EXCEPTION 'seed assertion failed: point distribution custody counters'; END IF;
  IF EXISTS (SELECT 1 FROM handoff_loss_review WHERE handoff_id = '00000000-0000-4000-8000-0000000b5004') THEN
    RAISE EXCEPTION 'seed assertion failed: the demo LOSS handoff must stay pending';
  END IF;
END $$;

COMMIT;
