\i constraint-tests.sql
-- seed
INSERT INTO item_type VALUES ('FOOD','Lương thực'); INSERT INTO unit VALUES ('PIECE','cái',0),('KG','kg',3);
INSERT INTO item (id,item_type_code,unit_code,name) VALUES ('00000000-0000-0000-0000-0000000000c1','FOOD','PIECE','Mì gói'),('00000000-0000-0000-0000-0000000000c2','FOOD','KG','Gạo');
INSERT INTO warehouse (id,organization_id,region_code,name) VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000aaa1','R1','Kho 1');
INSERT INTO relief_point (id,organization_id,region_code,name,location) VALUES ('00000000-0000-0000-0000-0000000000d9','00000000-0000-0000-0000-00000000aaa1','R1','Điểm 1',ST_GeogFromText('SRID=4326;POINT(106.7 10.7)'));
INSERT INTO stock_balance (id,warehouse_id,item_id) VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c1');
-- names
SELECT expect_fail('vehicle needs a region', $$INSERT INTO vehicle (organization_id,identifier,vehicle_type) VALUES (gen_random_uuid(),'x','truck')$$);
SELECT expect_fail('item name NFC only', $$INSERT INTO item (item_type_code,unit_code,name) VALUES ('FOOD','PIECE',normalize('Cụ',NFD))$$);
SELECT expect_fail('vehicle identifier case-insensitive', $$INSERT INTO vehicle (organization_id,region_code,identifier,vehicle_type) VALUES ('00000000-0000-0000-0000-00000000aaa1','R1','51A-1','truck'),('00000000-0000-0000-0000-00000000aaa1','R1','51a-1','truck')$$);
-- ledger drives the balance
INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','OPENING',5,0,'open1',gen_random_uuid());
SELECT 'balance after OPENING +5: '||on_hand FROM stock_balance;
SELECT expect_fail('reserved <= on_hand', $$UPDATE stock_balance SET reserved=6$$);
SELECT expect_fail('ISSUE shape', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,commitment_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','ISSUE',-1,0,gen_random_uuid(),'op1',gen_random_uuid())$$);
SELECT expect_fail('RESERVE needs a source', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RESERVE',0,1,'op3',gen_random_uuid())$$);
SELECT expect_fail('OPENING must not carry a commitment', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,commitment_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','OPENING',1,0,gen_random_uuid(),'op4',gen_random_uuid())$$);
SELECT expect_fail('ADJUSTMENT without an approved request', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,reason,adjustment_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','ADJUSTMENT',100,0,'x',gen_random_uuid(),'op5',gen_random_uuid())$$);
-- two-person adjustment
INSERT INTO stock_adjustment (id,balance_id,delta_on_hand,reason,requested_by_user_id) VALUES ('00000000-0000-0000-0000-000000000aa1','00000000-0000-0000-0000-0000000000e1',-2,'hao hụt','00000000-0000-0000-0000-000000000001');
SELECT expect_fail('adjustment cannot be self-reviewed', $$UPDATE stock_adjustment SET status='APPROVED',reviewed_by_user_id=requested_by_user_id,reviewed_at=now()$$);
SELECT expect_fail('reject needs a note', $$UPDATE stock_adjustment SET status='REJECTED',reviewed_by_user_id='00000000-0000-0000-0000-000000000002',reviewed_at=now()$$);
UPDATE stock_adjustment SET status='APPROVED',reviewed_by_user_id='00000000-0000-0000-0000-000000000002',reviewed_at=now();
SELECT expect_fail('reviewed adjustment is immutable', $$UPDATE stock_adjustment SET reason='changed'$$);
INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,reason,adjustment_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','ADJUSTMENT',-2,0,'hao hụt','00000000-0000-0000-0000-000000000aa1','ADJ:1','00000000-0000-0000-0000-000000000002');
SELECT 'balance after approved ADJUSTMENT -2: '||on_hand FROM stock_balance;
-- the balance CHECK (not an unrelated FK) must stop an approved adjustment that would drive on_hand below zero
INSERT INTO stock_adjustment (id,balance_id,delta_on_hand,reason,requested_by_user_id) VALUES ('00000000-0000-0000-0000-000000000aa9','00000000-0000-0000-0000-0000000000e1',-100,'kiểm tra âm kho','00000000-0000-0000-0000-000000000001');
UPDATE stock_adjustment SET status='APPROVED',reviewed_by_user_id='00000000-0000-0000-0000-000000000002',reviewed_at=now() WHERE id='00000000-0000-0000-0000-000000000aa9';
DO $$ BEGIN
  BEGIN
    INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,adjustment_id,operation_ref,actor_user_id,reason) VALUES ('00000000-0000-0000-0000-0000000000e1','ADJUSTMENT',-100,0,'00000000-0000-0000-0000-000000000aa9','ADJ:neg','00000000-0000-0000-0000-000000000002','x');
    RAISE EXCEPTION 'FAIL negative stock accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%stock_balance_check%' AND SQLERRM NOT LIKE '%stock_balance%' THEN RAISE EXCEPTION 'FAIL wrong constraint: %', SQLERRM; END IF;
    RAISE NOTICE 'PASS balance cannot go below zero via a movement (stock_balance CHECK)';
  END;
END $$;
SELECT expect_fail('adjustment applied only once (different op ref)', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,reason,adjustment_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','ADJUSTMENT',-2,0,'hao hụt','00000000-0000-0000-0000-000000000aa1','ADJ:2','00000000-0000-0000-0000-000000000002')$$);
SELECT expect_fail('ledger append-only', $$DELETE FROM stock_movement$$);
SELECT expect_fail('ledger cannot be truncated', $$TRUNCATE stock_movement CASCADE$$);
-- drive / organization consistency
SELECT expect_fail('drive organization must equal intake warehouse organization', $$INSERT INTO donation_drive (organization_id,intake_warehouse_id,title) VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000000d1','Đợt 1')$$);
INSERT INTO donation_drive (id,organization_id,intake_warehouse_id,title) VALUES ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-00000000aaa1','00000000-0000-0000-0000-0000000000d1','Đợt 1');
-- declaration revisions
SELECT expect_fail('delivery organization must match drive organization', $$INSERT INTO donation_delivery (public_code,drive_id,organization_id,donor_name,donor_phone) VALUES ('DN000002','00000000-0000-0000-0000-0000000000f1',gen_random_uuid(),'Bình','0900000002')$$);
INSERT INTO donation_delivery (id,public_code,drive_id,organization_id,donor_name,donor_phone) VALUES ('00000000-0000-0000-0000-000000000a11','DN000001','00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-00000000aaa1','An','0900000001');
INSERT INTO donation_declaration (delivery_id,revision,created_by_kind) VALUES ('00000000-0000-0000-0000-000000000a11',1,'DONOR');
INSERT INTO donation_line VALUES ('00000000-0000-0000-0000-000000000a11',1,'00000000-0000-0000-0000-0000000000c1',60);
SELECT expect_fail('piece quantity cannot have decimals', $$INSERT INTO donation_declaration (delivery_id,revision,created_by_kind) VALUES ('00000000-0000-0000-0000-000000000a11',2,'DONOR'); INSERT INTO donation_line VALUES ('00000000-0000-0000-0000-000000000a11',2,'00000000-0000-0000-0000-0000000000c1',0.5)$$);
INSERT INTO donation_declaration (delivery_id,revision,created_by_kind) VALUES ('00000000-0000-0000-0000-000000000a11',3,'DONOR');
INSERT INTO donation_line VALUES ('00000000-0000-0000-0000-000000000a11',3,'00000000-0000-0000-0000-0000000000c2',12.500);
SELECT expect_fail('declarations are immutable', $$UPDATE donation_declaration SET created_by_kind='STAFF_ASSISTED'$$);
-- receipt: counts, independent review
INSERT INTO donation_receipt (id,delivery_id,warehouse_id) VALUES ('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000a11','00000000-0000-0000-0000-0000000000d1');
INSERT INTO receipt_count (receipt_id,revision,counted_by_user_id) VALUES ('00000000-0000-0000-0000-000000000b11',1,'00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-000000000b11',2,'00000000-0000-0000-0000-0000000000a2');
INSERT INTO receipt_count_line (receipt_id,revision,item_id,counted_quantity,accepted_quantity,held_quantity,rejected_quantity) VALUES ('00000000-0000-0000-0000-000000000b11',1,'00000000-0000-0000-0000-0000000000c1',58,55,0,3);
INSERT INTO receipt_count_line (receipt_id,revision,item_id,counted_quantity,accepted_quantity,held_quantity,rejected_quantity) VALUES ('00000000-0000-0000-0000-000000000b11',2,'00000000-0000-0000-0000-0000000000c1',58,50,5,3);
SELECT expect_fail('counted must equal split', $$INSERT INTO receipt_count_line (receipt_id,revision,item_id,counted_quantity,accepted_quantity,held_quantity,rejected_quantity) VALUES ('00000000-0000-0000-0000-000000000b11',1,'00000000-0000-0000-0000-0000000000c2',10,5,0,0)$$);
SELECT expect_fail('count revisions immutable', $$UPDATE receipt_count_line SET accepted_quantity=58$$);
SELECT expect_fail('count lines respect unit scale', $$INSERT INTO receipt_count_line (receipt_id,revision,item_id,counted_quantity,accepted_quantity,held_quantity,rejected_quantity) VALUES ('00000000-0000-0000-0000-000000000b11',1,'00000000-0000-0000-0000-0000000000c1',1.5,1.5,0,0)$$);
SELECT expect_fail('reviewer must not be a count author', $$INSERT INTO receipt_review (receipt_id,delivery_id,count_revision,declaration_revision,reviewer_user_id,decision) VALUES ('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000a11',2,3,'00000000-0000-0000-0000-0000000000a1','APPROVE')$$);
SELECT expect_fail('review must name a real declaration revision', $$INSERT INTO receipt_review (receipt_id,delivery_id,count_revision,declaration_revision,reviewer_user_id,decision) VALUES ('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000a11',2,99,'00000000-0000-0000-0000-0000000000b1','APPROVE')$$);
INSERT INTO receipt_review (receipt_id,delivery_id,count_revision,declaration_revision,reviewer_user_id,decision) VALUES ('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000a11',2,3,'00000000-0000-0000-0000-0000000000b1','APPROVE');
SELECT expect_fail('a reviewer cannot later count', $$INSERT INTO receipt_count (receipt_id,revision,counted_by_user_id) VALUES ('00000000-0000-0000-0000-000000000b11',3,'00000000-0000-0000-0000-0000000000b1')$$);
SELECT expect_fail('second APPROVE on one revision', $$INSERT INTO receipt_review (receipt_id,delivery_id,count_revision,declaration_revision,reviewer_user_id,decision) VALUES ('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000a11',2,3,'00000000-0000-0000-0000-0000000000b2','APPROVE')$$);
INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,receipt_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RECEIPT',50,0,'00000000-0000-0000-0000-000000000b11','RCPT:1',gen_random_uuid());
SELECT expect_fail('initial receipt posts once (different op ref)', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,receipt_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RECEIPT',50,0,'00000000-0000-0000-0000-000000000b11','RCPT:1-replay',gen_random_uuid())$$);
SELECT expect_fail('resolved dispute needs note and resolver', $$INSERT INTO donation_dispute (delivery_id,status,opened_by_kind,reason,resolved_at) VALUES ('00000000-0000-0000-0000-000000000a11','RESOLVED','DONOR','x',now())$$);
-- need / commitment / distribution
INSERT INTO fulfillment_cycle (id,request_id,work_cycle,organization_id) VALUES ('00000000-0000-0000-0000-000000000c11',gen_random_uuid(),1,'00000000-0000-0000-0000-00000000aaa1');
INSERT INTO relief_need (id,cycle_id,item_id,original_quantity,requested_quantity) VALUES ('00000000-0000-0000-0000-000000000a21','00000000-0000-0000-0000-000000000c11','00000000-0000-0000-0000-0000000000c1',20,20);
SELECT expect_fail('one live need per item per cycle', $$INSERT INTO relief_need (cycle_id,item_id,original_quantity,requested_quantity) VALUES ('00000000-0000-0000-0000-000000000c11','00000000-0000-0000-0000-0000000000c1',5,5)$$);
SELECT expect_fail('cancelled_remaining bounded by requested', $$UPDATE relief_need SET status='CANCELLED',cancelled_remaining=99999$$);
SELECT expect_fail('commitment item must equal the need item', $$INSERT INTO commitment (relief_need_id,item_id,warehouse_id,quantity,created_by_user_id) VALUES ('00000000-0000-0000-0000-000000000a21','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000d1',1,gen_random_uuid())$$);
INSERT INTO commitment (id,relief_need_id,item_id,warehouse_id,quantity,created_by_user_id) VALUES ('00000000-0000-0000-0000-000000000a31','00000000-0000-0000-0000-000000000a21','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000d1',12,gen_random_uuid());
SELECT expect_fail('issued cannot exceed quantity-released', $$UPDATE commitment SET issued_quantity=13$$);
SELECT expect_fail('settled cannot exceed issued', $$UPDATE commitment SET issued_quantity=5, delivered_quantity=6$$);
INSERT INTO distribution (id,warehouse_id,organization_id,purpose,preparer_user_id,relief_point_id) VALUES ('00000000-0000-0000-0000-000000000d11','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000aaa1','CAMPAIGN_DISTRIBUTION','00000000-0000-0000-0000-000000000001',NULL),('00000000-0000-0000-0000-000000000d12','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000aaa1','POINT_REPLENISHMENT','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000d9');
SELECT expect_fail('POINT_REPLENISHMENT needs a point', $$INSERT INTO distribution (warehouse_id,organization_id,purpose,preparer_user_id) VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000aaa1','POINT_REPLENISHMENT',gen_random_uuid())$$);
SELECT expect_fail('distribution organization must equal warehouse organization', $$INSERT INTO distribution (warehouse_id,organization_id,purpose,preparer_user_id) VALUES ('00000000-0000-0000-0000-0000000000d1',gen_random_uuid(),'CAMPAIGN_DISTRIBUTION',gen_random_uuid())$$);
SELECT expect_fail('line item must equal the commitment item', $$INSERT INTO distribution_line (distribution_id,warehouse_id,item_id,commitment_id,quantity) VALUES ('00000000-0000-0000-0000-000000000d11','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-000000000a31',1)$$);
INSERT INTO warehouse (id,organization_id,region_code,name) VALUES ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-00000000aaa1','R1','Kho 2');
SELECT expect_fail('line warehouse must equal the distribution warehouse', $$INSERT INTO distribution_line (distribution_id,warehouse_id,item_id,quantity) VALUES ('00000000-0000-0000-0000-000000000d11','00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000c1',1)$$);
INSERT INTO distribution_line (id,distribution_id,warehouse_id,item_id,quantity) VALUES ('00000000-0000-0000-0000-000000000e11','00000000-0000-0000-0000-000000000d11','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c1',10),('00000000-0000-0000-0000-000000000e12','00000000-0000-0000-0000-000000000d12','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c1',10);
SELECT expect_fail('in-transit + at-point <= quantity', $$UPDATE distribution_line SET in_transit_quantity=11 WHERE id='00000000-0000-0000-0000-000000000e11'$$);
SELECT expect_fail('self-approval of distribution', $$UPDATE distribution SET status='APPROVED',approver_user_id=preparer_user_id,approved_version=version,approved_at=now() WHERE id='00000000-0000-0000-0000-000000000d11'$$);
UPDATE distribution SET status='APPROVED',approver_user_id='00000000-0000-0000-0000-000000000003',approved_version=version,approved_at=now() WHERE id='00000000-0000-0000-0000-000000000d11';
SELECT expect_fail('lines frozen after approval', $$UPDATE distribution_line SET quantity=9 WHERE id='00000000-0000-0000-0000-000000000e11'$$);
SELECT expect_fail('approval must match version (edit voids it)', $$UPDATE distribution SET version=version+1 WHERE id='00000000-0000-0000-0000-000000000d11'$$);
-- handoffs
SELECT expect_fail('direct handoff not allowed when distribution has a relief point', $$INSERT INTO handoff_record (distribution_id,handoff_kind,recorder_user_id,confirmation_basis,occurred_at) VALUES ('00000000-0000-0000-0000-000000000d12','DIRECT_HOUSEHOLD',gen_random_uuid(),'ký nhận',now())$$);
SELECT expect_fail('point receipt needs a relief point', $$INSERT INTO handoff_record (distribution_id,handoff_kind,recorder_user_id,confirmation_basis,occurred_at) VALUES ('00000000-0000-0000-0000-000000000d11','POINT_RECEIPT',gen_random_uuid(),'ký nhận',now())$$);
INSERT INTO handoff_record (id,distribution_id,handoff_kind,recorder_user_id,confirmation_basis,occurred_at) VALUES ('00000000-0000-0000-0000-000000000f11','00000000-0000-0000-0000-000000000d12','POINT_RECEIPT',gen_random_uuid(),'ký nhận',now());
SELECT expect_fail('handoff line must belong to the same distribution as its header', $$INSERT INTO handoff_line (handoff_id,distribution_id,distribution_line_id,quantity) VALUES ('00000000-0000-0000-0000-000000000f11','00000000-0000-0000-0000-000000000d12','00000000-0000-0000-0000-000000000e11',5)$$);
INSERT INTO handoff_line (id,handoff_id,distribution_id,distribution_line_id,quantity) VALUES ('00000000-0000-0000-0000-000000000f21','00000000-0000-0000-0000-000000000f11','00000000-0000-0000-0000-000000000d12','00000000-0000-0000-0000-000000000e12',5);
SELECT expect_fail('same line twice in one handoff', $$INSERT INTO handoff_line (handoff_id,distribution_id,distribution_line_id,quantity) VALUES ('00000000-0000-0000-0000-000000000f11','00000000-0000-0000-0000-000000000d12','00000000-0000-0000-0000-000000000e12',1)$$);
SELECT expect_fail('RETURN needs a source stage', $$INSERT INTO handoff_record (distribution_id,handoff_kind,recorder_user_id,confirmation_basis,occurred_at) VALUES ('00000000-0000-0000-0000-000000000d12','RETURN',gen_random_uuid(),'x',now())$$);
SELECT expect_fail('handoff records are immutable', $$UPDATE handoff_record SET confirmation_basis='đổi'$$);
SELECT expect_fail('RETURN movement needs its handoff line', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RETURN',1,0,'ret0',gen_random_uuid())$$);

-- ================= T0-S additions =================
-- need: requested may exceed original (original is the initial quantity)
UPDATE relief_need SET requested_quantity = 25 WHERE id = '00000000-0000-0000-0000-000000000a21';
DO $$ BEGIN IF (SELECT requested_quantity FROM relief_need WHERE id='00000000-0000-0000-0000-000000000a21') <> 25 THEN RAISE EXCEPTION 'FAIL need increase'; END IF; RAISE NOTICE 'PASS need requested above original accepted'; END $$;

-- distribution approval: approver <> preparer accepted was done above (d11); preparer approval rejected above. Dispatcher cannot equal approver:
SELECT expect_fail('dispatcher must differ from approver', $$UPDATE distribution SET status='DISPATCHED',dispatch_actor_user_id=approver_user_id,dispatched_at=now() WHERE id='00000000-0000-0000-0000-000000000d11'$$);

-- receipt posting guard
INSERT INTO donation_delivery (id,public_code,drive_id,organization_id,donor_name,donor_phone) VALUES
 ('00000000-0000-0000-0000-000000000a12','DN000012','00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-00000000aaa1','Chi','0900000012'),
 ('00000000-0000-0000-0000-000000000a13','DN000013','00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-00000000aaa1','Dung','0900000013');
INSERT INTO donation_declaration (delivery_id,revision,created_by_kind) VALUES ('00000000-0000-0000-0000-000000000a12',1,'DONOR'),('00000000-0000-0000-0000-000000000a13',1,'DONOR');
INSERT INTO donation_receipt (id,delivery_id,warehouse_id) VALUES
 ('00000000-0000-0000-0000-000000000b12','00000000-0000-0000-0000-000000000a12','00000000-0000-0000-0000-0000000000d1'),
 ('00000000-0000-0000-0000-000000000b13','00000000-0000-0000-0000-000000000a13','00000000-0000-0000-0000-0000000000d1');
INSERT INTO receipt_count (receipt_id,revision,counted_by_user_id) VALUES ('00000000-0000-0000-0000-000000000b12',1,'00000000-0000-0000-0000-0000000000a3'),('00000000-0000-0000-0000-000000000b13',1,'00000000-0000-0000-0000-0000000000a5');
-- b13: counted but never reviewed
SELECT expect_fail('RECEIPT without any review rejected', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,receipt_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RECEIPT',5,0,'00000000-0000-0000-0000-000000000b13','RCPT:13',gen_random_uuid())$$);
SELECT expect_fail('RECEIPT_HELD_RELEASE without any review rejected', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,receipt_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RECEIPT_HELD_RELEASE',1,0,'00000000-0000-0000-0000-000000000b13','HELD:13',gen_random_uuid())$$);
SELECT expect_fail('REJECT review does not allow posting', $$INSERT INTO receipt_review (receipt_id,delivery_id,count_revision,declaration_revision,reviewer_user_id,decision,reason) VALUES ('00000000-0000-0000-0000-000000000b13','00000000-0000-0000-0000-000000000a13',1,1,'00000000-0000-0000-0000-0000000000b5','REJECT','sai'); INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,receipt_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RECEIPT',5,0,'00000000-0000-0000-0000-000000000b13','RCPT:13b',gen_random_uuid())$$);
-- b12: approve rev 1, then a newer rev 2 appears -> approval is stale
INSERT INTO receipt_review (receipt_id,delivery_id,count_revision,declaration_revision,reviewer_user_id,decision) VALUES ('00000000-0000-0000-0000-000000000b12','00000000-0000-0000-0000-000000000a12',1,1,'00000000-0000-0000-0000-0000000000b3','APPROVE');
INSERT INTO receipt_count (receipt_id,revision,counted_by_user_id) VALUES ('00000000-0000-0000-0000-000000000b12',2,'00000000-0000-0000-0000-0000000000a4');
SELECT expect_fail('APPROVE on an older count revision is stale', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,receipt_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RECEIPT',5,0,'00000000-0000-0000-0000-000000000b12','RCPT:12a',gen_random_uuid())$$);
SELECT expect_fail('held release on a stale approval rejected', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,receipt_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RECEIPT_HELD_RELEASE',1,0,'00000000-0000-0000-0000-000000000b12','HELD:12a',gen_random_uuid())$$);
INSERT INTO receipt_review (receipt_id,delivery_id,count_revision,declaration_revision,reviewer_user_id,decision) VALUES ('00000000-0000-0000-0000-000000000b12','00000000-0000-0000-0000-000000000a12',2,1,'00000000-0000-0000-0000-0000000000b4','APPROVE');
SELECT expect_fail('poster who counted the latest revision rejected', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,receipt_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RECEIPT',5,0,'00000000-0000-0000-0000-000000000b12','RCPT:12b','00000000-0000-0000-0000-0000000000a4')$$);
SELECT expect_fail('poster who counted an earlier revision rejected', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,receipt_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RECEIPT',5,0,'00000000-0000-0000-0000-000000000b12','RCPT:12c','00000000-0000-0000-0000-0000000000a3')$$);
SELECT expect_fail('held release by a counter rejected', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,receipt_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RECEIPT_HELD_RELEASE',1,0,'00000000-0000-0000-0000-000000000b12','HELD:12b','00000000-0000-0000-0000-0000000000a3')$$);
INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,receipt_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RECEIPT',5,0,'00000000-0000-0000-0000-000000000b12','RCPT:12d',gen_random_uuid());
INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,receipt_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RECEIPT_HELD_RELEASE',1,0,'00000000-0000-0000-0000-000000000b12','HELD:12c',gen_random_uuid());
SELECT 'PASS legit RECEIPT and RECEIPT_HELD_RELEASE posted by an independent actor';
-- a later declaration revision voids the approval too
INSERT INTO donation_declaration (delivery_id,revision,created_by_kind) VALUES ('00000000-0000-0000-0000-000000000a12',2,'DONOR');
SELECT expect_fail('held release after a newer declaration revision rejected', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,receipt_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RECEIPT_HELD_RELEASE',1,0,'00000000-0000-0000-0000-000000000b12','HELD:12d',gen_random_uuid())$$);

-- compensating adjustment
INSERT INTO stock_adjustment (id,balance_id,delta_on_hand,reason,requested_by_user_id,compensates_movement_id) SELECT '00000000-0000-0000-0000-000000000aa2',balance_id,5,'đảo bút toán mở đầu','00000000-0000-0000-0000-000000000001',NULL FROM stock_movement WHERE operation_ref='open1';
SELECT expect_fail('compensation must invert the movement', $$INSERT INTO stock_adjustment (balance_id,delta_on_hand,reason,requested_by_user_id,compensates_movement_id) SELECT balance_id,-4,'sai',requested_by_user_id,m.id FROM stock_movement m, (SELECT '00000000-0000-0000-0000-000000000001'::uuid AS requested_by_user_id) x WHERE operation_ref='open1'$$);
INSERT INTO stock_adjustment (id,balance_id,delta_on_hand,reason,requested_by_user_id,compensates_movement_id) SELECT '00000000-0000-0000-0000-000000000aa3',balance_id,-5,'đảo','00000000-0000-0000-0000-000000000001',id FROM stock_movement WHERE operation_ref='open1';
SELECT expect_fail('a movement is compensated at most once', $$INSERT INTO stock_adjustment (balance_id,delta_on_hand,reason,requested_by_user_id,compensates_movement_id) SELECT balance_id,-5,'lần hai','00000000-0000-0000-0000-000000000001',id FROM stock_movement WHERE operation_ref='open1'$$);

-- settlement / commitment counters / loss review (distribution d13 has no point: DIRECT_HOUSEHOLD and LOSS from IN_TRANSIT allowed)
INSERT INTO distribution (id,warehouse_id,organization_id,purpose,preparer_user_id) VALUES ('00000000-0000-0000-0000-000000000d13','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000aaa1','CAMPAIGN_DISTRIBUTION','00000000-0000-0000-0000-000000000001');
INSERT INTO distribution_line (id,distribution_id,warehouse_id,item_id,commitment_id,quantity) VALUES ('00000000-0000-0000-0000-000000000e13','00000000-0000-0000-0000-000000000d13','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000a31',10);
INSERT INTO handoff_record (id,distribution_id,handoff_kind,recorder_user_id,confirmation_basis,occurred_at) VALUES ('00000000-0000-0000-0000-000000000f12','00000000-0000-0000-0000-000000000d13','DIRECT_HOUSEHOLD','00000000-0000-0000-0000-000000000011','ký nhận',now());
INSERT INTO handoff_line (id,handoff_id,distribution_id,distribution_line_id,commitment_id,quantity) VALUES ('00000000-0000-0000-0000-000000000f22','00000000-0000-0000-0000-000000000f12','00000000-0000-0000-0000-000000000d13','00000000-0000-0000-0000-000000000e13','00000000-0000-0000-0000-000000000a31',6);
INSERT INTO issued_line_settlement (handoff_line_id,commitment_id,settlement_type) VALUES ('00000000-0000-0000-0000-000000000f22','00000000-0000-0000-0000-000000000a31','DELIVERED');
SELECT expect_fail('one settlement per handoff line', $$INSERT INTO issued_line_settlement (handoff_line_id,commitment_id,settlement_type) VALUES ('00000000-0000-0000-0000-000000000f22','00000000-0000-0000-0000-000000000a31','DELIVERED')$$);
-- counters not yet updated -> reconciliation view reports the commitment
DO $$ BEGIN IF (SELECT count(*) FROM commitment_counter_mismatch) <> 1 THEN RAISE EXCEPTION 'FAIL reconciliation should detect stale counters'; END IF; RAISE NOTICE 'PASS reconciliation view detects stale counters'; END $$;
UPDATE commitment SET issued_quantity = 6, delivered_quantity = 6 WHERE id = '00000000-0000-0000-0000-000000000a31';
DO $$ BEGIN IF EXISTS (SELECT 1 FROM commitment_counter_mismatch) THEN RAISE EXCEPTION 'FAIL reconciliation mismatch on fixture'; END IF; RAISE NOTICE 'PASS counter reconciliation: zero mismatches'; END $$;
SELECT expect_fail('settlements are append-only', $$UPDATE issued_line_settlement SET settlement_type='LOST'$$);

-- loss handoff review
INSERT INTO handoff_record (id,distribution_id,handoff_kind,source_stage,recorder_user_id,confirmation_basis,occurred_at) VALUES ('00000000-0000-0000-0000-000000000f14','00000000-0000-0000-0000-000000000d13','LOSS','IN_TRANSIT','00000000-0000-0000-0000-000000000022','mất hàng',now());
INSERT INTO handoff_line (id,handoff_id,distribution_id,distribution_line_id,commitment_id,quantity) VALUES ('00000000-0000-0000-0000-000000000f24','00000000-0000-0000-0000-000000000f14','00000000-0000-0000-0000-000000000d13','00000000-0000-0000-0000-000000000e13','00000000-0000-0000-0000-000000000a31',2);
SELECT expect_fail('LOST settlement needs an APPROVE loss review', $$INSERT INTO issued_line_settlement (handoff_line_id,commitment_id,settlement_type) VALUES ('00000000-0000-0000-0000-000000000f24','00000000-0000-0000-0000-000000000a31','LOST')$$);
SELECT expect_fail('loss reviewer must differ from recorder', $$INSERT INTO handoff_loss_review (handoff_id,reviewer_user_id,decision,reason) VALUES ('00000000-0000-0000-0000-000000000f14','00000000-0000-0000-0000-000000000022','APPROVE','ok')$$);
SELECT expect_fail('only LOSS handoffs can be reviewed', $$INSERT INTO handoff_loss_review (handoff_id,reviewer_user_id,decision,reason) VALUES ('00000000-0000-0000-0000-000000000f12','00000000-0000-0000-0000-000000000033','APPROVE','ok')$$);
SELECT expect_fail('loss review needs a reason', $$INSERT INTO handoff_loss_review (handoff_id,reviewer_user_id,decision,reason) VALUES ('00000000-0000-0000-0000-000000000f14','00000000-0000-0000-0000-000000000033','APPROVE',' ')$$);
INSERT INTO handoff_loss_review (handoff_id,reviewer_user_id,decision,reason) VALUES ('00000000-0000-0000-0000-000000000f14','00000000-0000-0000-0000-000000000033','APPROVE','đã xác minh');
SELECT expect_fail('second loss review rejected', $$INSERT INTO handoff_loss_review (handoff_id,reviewer_user_id,decision,reason) VALUES ('00000000-0000-0000-0000-000000000f14','00000000-0000-0000-0000-000000000044','REJECT','khác')$$);
SELECT expect_fail('loss review is append-only', $$UPDATE handoff_loss_review SET decision='REJECT'$$);
SELECT expect_fail('handoff_record update still rejected', $$UPDATE handoff_record SET confirmation_basis='đổi' WHERE id='00000000-0000-0000-0000-000000000f14'$$);
INSERT INTO issued_line_settlement (handoff_line_id,commitment_id,settlement_type) VALUES ('00000000-0000-0000-0000-000000000f24','00000000-0000-0000-0000-000000000a31','LOST');
UPDATE commitment SET issued_quantity = 8, lost_quantity = 2 WHERE id = '00000000-0000-0000-0000-000000000a31';
DO $$ BEGIN IF EXISTS (SELECT 1 FROM commitment_counter_mismatch) THEN RAISE EXCEPTION 'FAIL reconciliation after LOSS'; END IF; RAISE NOTICE 'PASS reconciliation incl. approved LOSS: zero mismatches'; END $$;

-- cycle_intent
DO $$ BEGIN IF EXISTS (SELECT 1 FROM check_cycle_state_matches_intent()) THEN RAISE EXCEPTION 'FAIL cycle state/intent mismatch on fresh fixture'; END IF; RAISE NOTICE 'PASS OPEN cycle without intent is consistent'; END $$;
SELECT expect_fail('RESOLUTION cannot be FROZEN', $$INSERT INTO cycle_intent (intent_id,cycle_id,kind,state) VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000c11','RESOLUTION','FROZEN')$$);
SELECT expect_fail('CANCELLATION cannot be SEALED', $$INSERT INTO cycle_intent (intent_id,cycle_id,kind,state) VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000c11','CANCELLATION','SEALED')$$);
INSERT INTO cycle_intent (intent_id,cycle_id,kind,state) VALUES ('00000000-0000-0000-0000-0000000001a1','00000000-0000-0000-0000-000000000c11','RESOLUTION','SEALED');
DO $$ BEGIN IF (SELECT count(*) FROM check_cycle_state_matches_intent()) <> 1 THEN RAISE EXCEPTION 'FAIL expected mismatch: OPEN cycle with SEALED intent'; END IF; RAISE NOTICE 'PASS mismatch detected: OPEN cycle, SEALED intent'; END $$;
UPDATE fulfillment_cycle SET state='SEALED' WHERE id='00000000-0000-0000-0000-000000000c11';
DO $$ BEGIN IF EXISTS (SELECT 1 FROM check_cycle_state_matches_intent()) THEN RAISE EXCEPTION 'FAIL sealed cycle should match'; END IF; RAISE NOTICE 'PASS SEALED cycle matches SEALED intent'; END $$;
SELECT expect_fail('only one live intent per cycle', $$INSERT INTO cycle_intent (intent_id,cycle_id,kind,state) VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000c11','CANCELLATION','FROZEN')$$);
SELECT expect_fail('intent binding columns are immutable', $$UPDATE cycle_intent SET kind='CANCELLATION',state='FROZEN'$$);
SELECT expect_fail('intent cannot be deleted', $$DELETE FROM cycle_intent$$);
UPDATE cycle_intent SET state='ABORTED' WHERE intent_id='00000000-0000-0000-0000-0000000001a1';
SELECT expect_fail('aborted intent cannot be revived', $$UPDATE cycle_intent SET state='SEALED'$$);
DO $$ BEGIN IF (SELECT count(*) FROM check_cycle_state_matches_intent()) <> 1 THEN RAISE EXCEPTION 'FAIL expected mismatch: SEALED cycle, aborted intent'; END IF; RAISE NOTICE 'PASS mismatch detected: SEALED cycle, only aborted intent'; END $$;
UPDATE fulfillment_cycle SET state='OPEN' WHERE id='00000000-0000-0000-0000-000000000c11';
INSERT INTO cycle_intent (intent_id,cycle_id,kind,state) VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000c11','RESOLUTION','ABORTED'),(gen_random_uuid(),'00000000-0000-0000-0000-000000000c11','CANCELLATION','ABORTED');
INSERT INTO cycle_intent (intent_id,cycle_id,kind,state) VALUES ('00000000-0000-0000-0000-0000000001a2','00000000-0000-0000-0000-000000000c11','CANCELLATION','FROZEN');
UPDATE fulfillment_cycle SET state='FROZEN' WHERE id='00000000-0000-0000-0000-000000000c11';
DO $$ BEGIN IF EXISTS (SELECT 1 FROM check_cycle_state_matches_intent()) THEN RAISE EXCEPTION 'FAIL frozen cycle should match'; END IF; RAISE NOTICE 'PASS tombstones allowed; FROZEN cycle matches FROZEN intent'; END $$;

-- capability_recovery
INSERT INTO capability_recovery (delivery_id,code_hash,expires_at,issued_by_user_id,basis) VALUES ('00000000-0000-0000-0000-000000000a11','h1',now()+interval '30 minutes','00000000-0000-0000-0000-000000000001','xác minh qua điện thoại');
SELECT expect_fail('recovery code hash unique', $$INSERT INTO capability_recovery (delivery_id,code_hash,expires_at,issued_by_user_id,basis) VALUES ('00000000-0000-0000-0000-000000000a11','h1',now()+interval '30 minutes',gen_random_uuid(),'x')$$);
SELECT expect_fail('recovery must expire after creation', $$INSERT INTO capability_recovery (delivery_id,code_hash,expires_at,issued_by_user_id,basis) VALUES ('00000000-0000-0000-0000-000000000a11','h2',now()-interval '1 minute',gen_random_uuid(),'x')$$);
SELECT expect_fail('recovery consumed pair', $$INSERT INTO capability_recovery (delivery_id,code_hash,expires_at,issued_by_user_id,basis,consumed_at) VALUES ('00000000-0000-0000-0000-000000000a11','h3',now()+interval '1 hour',gen_random_uuid(),'x',now())$$);
SELECT expect_fail('recovery basis nonblank', $$INSERT INTO capability_recovery (delivery_id,code_hash,expires_at,issued_by_user_id,basis) VALUES ('00000000-0000-0000-0000-000000000a11','h4',now()+interval '1 hour',gen_random_uuid(),' ')$$);
SELECT expect_fail('recovery needs a real delivery', $$INSERT INTO capability_recovery (delivery_id,code_hash,expires_at,issued_by_user_id,basis) VALUES (gen_random_uuid(),'h5',now()+interval '1 hour',gen_random_uuid(),'x')$$);

-- idempotency resource pair, attachment owner, dispute status
SELECT expect_fail('idempotency resource pair', $$INSERT INTO idempotency_record (scope_key,command,idempotency_key,request_hash,resource_type) VALUES ('s','c',gen_random_uuid(),'h','DELIVERY')$$);
SELECT expect_fail('attachment needs exactly one owner', $$INSERT INTO logistics_attachment (object_key,declared_bytes) VALUES ('k1',10)$$);
SELECT expect_fail('dispute WITHDRAWN no longer exists', $$INSERT INTO donation_dispute (delivery_id,status,opened_by_kind,reason) VALUES ('00000000-0000-0000-0000-000000000a11','WITHDRAWN','DONOR','x')$$);

-- ================= organization guards (01 §7) =================
INSERT INTO warehouse (id,organization_id,region_code,name) VALUES ('00000000-0000-0000-0000-0000000000d3','00000000-0000-0000-0000-00000000aaa2','R1','Kho tổ chức khác');
INSERT INTO relief_point (id,organization_id,region_code,name,location) VALUES ('00000000-0000-0000-0000-0000000000d8','00000000-0000-0000-0000-00000000aaa2','R1','Điểm tổ chức khác',ST_GeogFromText('SRID=4326;POINT(106.8 10.8)'));
INSERT INTO fulfillment_cycle (id,request_id,work_cycle,organization_id) VALUES ('00000000-0000-0000-0000-000000000c12',gen_random_uuid(),1,'00000000-0000-0000-0000-00000000aaa1');
SELECT expect_sqlstate('need point of another organization rejected', $$INSERT INTO relief_need (cycle_id,item_id,original_quantity,requested_quantity,designated_point_id) VALUES ('00000000-0000-0000-0000-000000000c12','00000000-0000-0000-0000-0000000000c2',5,5,'00000000-0000-0000-0000-0000000000d8')$$, '23514');
INSERT INTO relief_need (id,cycle_id,item_id,original_quantity,requested_quantity,designated_point_id) VALUES ('00000000-0000-0000-0000-000000000a22','00000000-0000-0000-0000-000000000c12','00000000-0000-0000-0000-0000000000c2',5,5,'00000000-0000-0000-0000-0000000000d9');
SELECT 'PASS need point of the same organization accepted';
SELECT expect_sqlstate('need point re-designated to another organization rejected', $$UPDATE relief_need SET designated_point_id='00000000-0000-0000-0000-0000000000d8' WHERE id='00000000-0000-0000-0000-000000000a22'$$, '23514');
SELECT expect_sqlstate('commitment warehouse of another organization rejected', $$INSERT INTO commitment (relief_need_id,item_id,warehouse_id,quantity,created_by_user_id) VALUES ('00000000-0000-0000-0000-000000000a22','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000d3',1,gen_random_uuid())$$, '23514');
INSERT INTO commitment (id,relief_need_id,item_id,warehouse_id,quantity,created_by_user_id) VALUES ('00000000-0000-0000-0000-000000000a32','00000000-0000-0000-0000-000000000a22','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000d2',2,gen_random_uuid());
SELECT 'PASS commitment warehouse of the same organization accepted';
SELECT expect_sqlstate('commitment moved to a foreign-organization warehouse rejected', $$UPDATE commitment SET warehouse_id='00000000-0000-0000-0000-0000000000d3' WHERE id='00000000-0000-0000-0000-000000000a32'$$, '23514');

-- ================= restricted application role (SECURITY DEFINER stock writer) =================
-- fixtures created as the owner of the schema, then everything below runs as c48_logistics_app
INSERT INTO item (id,item_type_code,unit_code,name) VALUES ('00000000-0000-0000-0000-0000000000c3','FOOD','PIECE','Nước đóng chai');
INSERT INTO warehouse (id,organization_id,region_code,name) VALUES ('00000000-0000-0000-0000-0000000000d4','00000000-0000-0000-0000-00000000aaa1','R1','Kho phân quyền');
INSERT INTO stock_balance (id,warehouse_id,item_id) VALUES ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-0000000000d4','00000000-0000-0000-0000-0000000000c3');
INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e2','OPENING',10,0,'role-open0',gen_random_uuid());

DO $$ BEGIN
  IF NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.proname='apply_stock_movement') THEN RAISE EXCEPTION 'FAIL apply_stock_movement is not SECURITY DEFINER'; END IF;
  IF NOT (SELECT coalesce(p.proconfig::text LIKE '%search_path=pg_catalog, public%', false) FROM pg_proc p WHERE p.proname='apply_stock_movement') THEN RAISE EXCEPTION 'FAIL apply_stock_movement has no pinned search_path'; END IF;
  IF (SELECT pg_get_userbyid(p.proowner) FROM pg_proc p WHERE p.proname='apply_stock_movement') <> 'c48_logistics_owner' THEN RAISE EXCEPTION 'FAIL wrong function owner'; END IF;
  IF (SELECT r.rolsuper OR r.rolcanlogin OR r.rolbypassrls FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.proname='apply_stock_movement') THEN RAISE EXCEPTION 'FAIL function owner is a superuser/login/bypassrls role'; END IF;
  IF (SELECT r.rolsuper OR r.rolbypassrls FROM pg_roles r WHERE r.rolname='c48_logistics_app') THEN RAISE EXCEPTION 'FAIL app role is privileged'; END IF;
  IF pg_has_role('c48_logistics_app','c48_logistics_owner','MEMBER') THEN RAISE EXCEPTION 'FAIL app role can act as the function owner'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname='c48_logistics_app')) THEN RAISE EXCEPTION 'FAIL app role owns a function'; END IF;
  RAISE NOTICE 'PASS apply_stock_movement: prosecdef, pinned search_path, owner c48_logistics_owner (not superuser, not the app role)';
END $$;

SET ROLE c48_logistics_app;
SELECT expect_sqlstate('app: direct UPDATE stock_balance denied', $$UPDATE stock_balance SET on_hand = on_hand + 1000$$, '42501');
SELECT expect_sqlstate('app: direct UPDATE of reserved denied', $$UPDATE stock_balance SET reserved = 1$$, '42501');
SELECT expect_sqlstate('app: DELETE stock_balance denied', $$DELETE FROM stock_balance$$, '42501');
SELECT expect_sqlstate('app: TRUNCATE stock_balance denied', $$TRUNCATE stock_balance CASCADE$$, '42501');
SELECT expect_sqlstate('app: INSERT stock_balance with on_hand=5 denied', $$INSERT INTO stock_balance (warehouse_id,item_id,on_hand) VALUES ('00000000-0000-0000-0000-0000000000d4','00000000-0000-0000-0000-0000000000c1',5)$$, '42501');
INSERT INTO stock_balance (id,warehouse_id,item_id) VALUES ('00000000-0000-0000-0000-0000000000e3','00000000-0000-0000-0000-0000000000d4','00000000-0000-0000-0000-0000000000c1');
SELECT 'PASS app: INSERT stock_balance (warehouse_id,item_id) with defaults allowed';
DO $$ DECLARE b record; BEGIN
  SELECT on_hand, reserved INTO b FROM stock_balance WHERE id='00000000-0000-0000-0000-0000000000e3';
  IF b.on_hand <> 0 OR b.reserved <> 0 THEN RAISE EXCEPTION 'FAIL new balance not zero'; END IF;
  RAISE NOTICE 'PASS app-created balance starts at zero';
END $$;
INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e3','OPENING',7,0,'role-open1',gen_random_uuid());
INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,commitment_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e3','RESERVE',0,3,'00000000-0000-0000-0000-000000000a31','role-res1',gen_random_uuid());
DO $$ DECLARE b record; BEGIN
  SELECT on_hand, reserved INTO b FROM stock_balance WHERE id='00000000-0000-0000-0000-0000000000e3';
  IF b.on_hand <> 7 OR b.reserved <> 3 THEN RAISE EXCEPTION 'FAIL definer trigger result on_hand=% reserved=% (expected 7/3)', b.on_hand, b.reserved; END IF;
  RAISE NOTICE 'PASS app: OPENING +7 and RESERVE 3 inserted; balance changed through the definer trigger (on_hand 7, reserved 3)';
END $$;
SELECT expect_sqlstate('app: over-reserve still stopped by the balance CHECK', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,commitment_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e3','RESERVE',0,5,'00000000-0000-0000-0000-000000000a31','role-res2',gen_random_uuid())$$, '23514');
-- append-only tables: privilege error first, trigger second
SELECT expect_sqlstate('app: UPDATE stock_movement denied', $$UPDATE stock_movement SET reason='x'$$, '42501');
SELECT expect_sqlstate('app: DELETE stock_movement denied', $$DELETE FROM stock_movement$$, '42501');
SELECT expect_sqlstate('app: TRUNCATE stock_movement denied', $$TRUNCATE stock_movement$$, '42501');
SELECT expect_sqlstate('app: UPDATE receipt_review denied', $$UPDATE receipt_review SET reason='x'$$, '42501');
SELECT expect_sqlstate('app: DELETE receipt_review denied', $$DELETE FROM receipt_review$$, '42501');
SELECT expect_sqlstate('app: TRUNCATE receipt_review denied', $$TRUNCATE receipt_review$$, '42501');
SELECT expect_sqlstate('app: UPDATE handoff_record denied', $$UPDATE handoff_record SET confirmation_basis='x'$$, '42501');
SELECT expect_sqlstate('app: DELETE handoff_record denied', $$DELETE FROM handoff_record$$, '42501');
SELECT expect_sqlstate('app: TRUNCATE handoff_record denied', $$TRUNCATE handoff_record CASCADE$$, '42501');
SELECT expect_sqlstate('app: UPDATE handoff_loss_review denied', $$UPDATE handoff_loss_review SET reason='x'$$, '42501');
SELECT expect_sqlstate('app: DELETE handoff_loss_review denied', $$DELETE FROM handoff_loss_review$$, '42501');
SELECT expect_sqlstate('app: TRUNCATE handoff_loss_review denied', $$TRUNCATE handoff_loss_review$$, '42501');
SELECT expect_sqlstate('app: UPDATE issued_line_settlement denied', $$UPDATE issued_line_settlement SET settlement_type='LOST'$$, '42501');
SELECT expect_sqlstate('app: UPDATE audit_log denied', $$UPDATE audit_log SET action='x'$$, '42501');
-- the function and the schema are not the app role's to change
SELECT expect_sqlstate('app: CREATE OR REPLACE apply_stock_movement denied', $$CREATE OR REPLACE FUNCTION apply_stock_movement() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NULL; END'$$, '42501');
SELECT expect_sqlstate('app: DROP FUNCTION apply_stock_movement denied', $$DROP FUNCTION apply_stock_movement() CASCADE$$, '42501');
SELECT expect_sqlstate('app: CREATE FUNCTION in public denied', $$CREATE FUNCTION public.shadow() RETURNS int LANGUAGE sql AS 'SELECT 1'$$, '42501');
SELECT expect_sqlstate('app: CREATE TABLE in public denied', $$CREATE TABLE public.shadow_t (a int)$$, '42501');
SELECT expect_sqlstate('app: DISABLE TRIGGER stock_movement_apply denied', $$ALTER TABLE stock_movement DISABLE TRIGGER stock_movement_apply$$, '42501');
-- mutable tables stay usable; DELETE only on the cleanup tables
INSERT INTO idempotency_record (scope_key,command,idempotency_key,request_hash) VALUES ('s','c','00000000-0000-0000-0000-0000000000f9','h');
DELETE FROM idempotency_record;
INSERT INTO notice (recipient_user_id,source_id,source_version,notice_type) VALUES (gen_random_uuid(),gen_random_uuid(),1,'T');
DELETE FROM notice;
SELECT 'PASS app: INSERT + DELETE on idempotency_record and notice';
SELECT expect_sqlstate('app: DELETE warehouse denied', $$DELETE FROM warehouse$$, '42501');
UPDATE donation_delivery SET status='COUNTING' WHERE id='00000000-0000-0000-0000-000000000a13';
SELECT 'PASS app: UPDATE on a mutable table (donation_delivery) allowed';
UPDATE cycle_intent SET state='ABORTED' WHERE state='FROZEN' AND intent_id='00000000-0000-0000-0000-0000000001a2';
SELECT 'PASS app: cycle_intent UPDATE to ABORTED allowed (trigger limits it to that)';
SELECT expect_sqlstate('app: cycle_intent cannot be revived (trigger)', $$UPDATE cycle_intent SET state='FROZEN'$$, '23514');
RESET ROLE;
