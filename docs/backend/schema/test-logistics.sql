\i constraint-tests.sql
-- seed
INSERT INTO item_type VALUES ('FOOD','Lương thực'); INSERT INTO unit VALUES ('PIECE','cái',0),('KG','kg',3);
INSERT INTO item (id,item_type_code,unit_code,name) VALUES ('00000000-0000-0000-0000-0000000000c1','FOOD','PIECE','Mì gói'),('00000000-0000-0000-0000-0000000000c2','FOOD','KG','Gạo');
INSERT INTO warehouse (id,organization_id,region_code,name) VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-00000000aaa1','R1','Kho 1');
INSERT INTO relief_point (id,organization_id,region_code,name,location) VALUES ('00000000-0000-0000-0000-0000000000d9','00000000-0000-0000-0000-00000000aaa1','R1','Điểm 1',ST_GeogFromText('SRID=4326;POINT(106.7 10.7)'));
INSERT INTO stock_balance (id,warehouse_id,item_id) VALUES ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000c1');
-- names
SELECT expect_fail('item name NFC only', $$INSERT INTO item (item_type_code,unit_code,name) VALUES ('FOOD','PIECE',normalize('Cụ',NFD))$$);
SELECT expect_fail('vehicle identifier case-insensitive', $$INSERT INTO vehicle (organization_id,identifier,vehicle_type) VALUES ('00000000-0000-0000-0000-00000000aaa1','51A-1','truck'),('00000000-0000-0000-0000-00000000aaa1','51a-1','truck')$$);
-- ledger drives the balance
INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','OPENING',5,0,'open1',gen_random_uuid());
SELECT 'balance after OPENING +5: '||on_hand FROM stock_balance;
SELECT expect_fail('balance cannot go below zero via a movement', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,commitment_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','ISSUE',-6,-6,gen_random_uuid(),'x1',gen_random_uuid())$$);
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
SELECT expect_fail('adjustment applied only once (different op ref)', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,reason,adjustment_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','ADJUSTMENT',-2,0,'hao hụt','00000000-0000-0000-0000-000000000aa1','ADJ:2','00000000-0000-0000-0000-000000000002')$$);
SELECT expect_fail('ledger append-only', $$DELETE FROM stock_movement$$);
SELECT expect_fail('ledger cannot be truncated', $$TRUNCATE stock_movement CASCADE$$);
-- drive / organization consistency
SELECT expect_fail('drive organization must equal intake warehouse organization', $$INSERT INTO donation_drive (organization_id,intake_warehouse_id,title,created_by_user_id) VALUES (gen_random_uuid(),'00000000-0000-0000-0000-0000000000d1','Đợt 1',gen_random_uuid())$$);
INSERT INTO donation_drive (id,organization_id,intake_warehouse_id,title,created_by_user_id) VALUES ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-00000000aaa1','00000000-0000-0000-0000-0000000000d1','Đợt 1',gen_random_uuid());
-- declaration revisions
BEGIN;
INSERT INTO donation_delivery (id,public_code,drive_id,donor_name,donor_phone) VALUES ('00000000-0000-0000-0000-000000000a11','DN000001','00000000-0000-0000-0000-0000000000f1','An','0900000001');
INSERT INTO donation_declaration (delivery_id,revision,created_by_kind) VALUES ('00000000-0000-0000-0000-000000000a11',1,'DONOR');
INSERT INTO donation_line VALUES ('00000000-0000-0000-0000-000000000a11',1,'00000000-0000-0000-0000-0000000000c1',60);
COMMIT;
SELECT expect_fail('delivery must point at an existing declaration revision', $$INSERT INTO donation_delivery (public_code,drive_id,donor_name,donor_phone,current_declaration_rev) VALUES ('DN000002','00000000-0000-0000-0000-0000000000f1','Bình','0900000002',99); SET CONSTRAINTS ALL IMMEDIATE$$);
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
SELECT expect_fail('reviewer must not be a count author', $$INSERT INTO receipt_review (receipt_id,delivery_id,count_revision,declaration_revision,reviewer_user_id,decision) VALUES ('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000a11',2,1,'00000000-0000-0000-0000-0000000000a1','APPROVE')$$);
SELECT expect_fail('review must name a real declaration revision', $$INSERT INTO receipt_review (receipt_id,delivery_id,count_revision,declaration_revision,reviewer_user_id,decision) VALUES ('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000a11',2,99,'00000000-0000-0000-0000-0000000000b1','APPROVE')$$);
INSERT INTO receipt_review (receipt_id,delivery_id,count_revision,declaration_revision,reviewer_user_id,decision) VALUES ('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000a11',2,1,'00000000-0000-0000-0000-0000000000b1','APPROVE');
SELECT expect_fail('a reviewer cannot later count', $$INSERT INTO receipt_count (receipt_id,revision,counted_by_user_id) VALUES ('00000000-0000-0000-0000-000000000b11',3,'00000000-0000-0000-0000-0000000000b1')$$);
SELECT expect_fail('second APPROVE on one revision', $$INSERT INTO receipt_review (receipt_id,delivery_id,count_revision,declaration_revision,reviewer_user_id,decision) VALUES ('00000000-0000-0000-0000-000000000b11','00000000-0000-0000-0000-000000000a11',2,1,'00000000-0000-0000-0000-0000000000b2','APPROVE')$$);
INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,receipt_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RECEIPT',50,0,'00000000-0000-0000-0000-000000000b11','RCPT:1',gen_random_uuid());
SELECT expect_fail('initial receipt posts once (different op ref)', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,receipt_id,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RECEIPT',50,0,'00000000-0000-0000-0000-000000000b11','RCPT:1-replay',gen_random_uuid())$$);
SELECT expect_fail('resolved dispute needs note and resolver', $$INSERT INTO donation_dispute (delivery_id,status,opened_by_kind,reason,resolved_at) VALUES ('00000000-0000-0000-0000-000000000a11','RESOLVED','DONOR','x',now())$$);
-- need / commitment / distribution
INSERT INTO fulfillment_cycle (id,request_id,work_cycle,organization_id) VALUES ('00000000-0000-0000-0000-000000000c11',gen_random_uuid(),1,'00000000-0000-0000-0000-00000000aaa1');
INSERT INTO relief_need (id,cycle_id,item_id,original_quantity,requested_quantity,created_by_user_id) VALUES ('00000000-0000-0000-0000-000000000a21','00000000-0000-0000-0000-000000000c11','00000000-0000-0000-0000-0000000000c1',20,20,gen_random_uuid());
SELECT expect_fail('one live need per item per cycle', $$INSERT INTO relief_need (cycle_id,item_id,original_quantity,requested_quantity,created_by_user_id) VALUES ('00000000-0000-0000-0000-000000000c11','00000000-0000-0000-0000-0000000000c1',5,5,gen_random_uuid())$$);
SELECT expect_fail('cancelled_remaining bounded by requested', $$UPDATE relief_need SET status='CANCELLED',cancelled_remaining=99999$$);
SELECT expect_fail('commitment item must equal the need item', $$INSERT INTO commitment (relief_need_id,item_id,warehouse_id,quantity,created_by_user_id) VALUES ('00000000-0000-0000-0000-000000000a21','00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000d1',1,gen_random_uuid())$$);
INSERT INTO commitment (id,relief_need_id,item_id,warehouse_id,quantity,created_by_user_id) VALUES ('00000000-0000-0000-0000-000000000a31','00000000-0000-0000-0000-000000000a21','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000d1',12,gen_random_uuid());
SELECT expect_fail('issued cannot exceed quantity-released', $$UPDATE commitment SET issued_quantity=13$$);
SELECT expect_fail('settled cannot exceed issued', $$UPDATE commitment SET issued_quantity=5, delivered_quantity=6$$);
SELECT expect_fail('sealed needs seal id', $$UPDATE fulfillment_cycle SET state='SEALED'$$);
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
SELECT expect_fail('LOSS needs a distinct approver', $$INSERT INTO handoff_record (distribution_id,handoff_kind,source_stage,recorder_user_id,approved_by_user_id,confirmation_basis,occurred_at) VALUES ('00000000-0000-0000-0000-000000000d12','LOSS','AT_POINT','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','x',now())$$);
SELECT expect_fail('RETURN needs a source stage', $$INSERT INTO handoff_record (distribution_id,handoff_kind,recorder_user_id,confirmation_basis,occurred_at) VALUES ('00000000-0000-0000-0000-000000000d12','RETURN',gen_random_uuid(),'x',now())$$);
SELECT expect_fail('handoff records are immutable', $$UPDATE handoff_record SET confirmation_basis='đổi'$$);
SELECT expect_fail('RETURN movement needs its handoff line', $$INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,operation_ref,actor_user_id) VALUES ('00000000-0000-0000-0000-0000000000e1','RETURN',1,0,'ret0',gen_random_uuid())$$);
