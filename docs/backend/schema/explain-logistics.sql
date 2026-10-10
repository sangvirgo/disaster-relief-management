-- Logistics EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) evidence for T0-S (01-schema-review.md §9.4).
-- Usage (superuser, fresh database already loaded from logistics.sql):
--   createdb hl_perf && psql -d hl_perf -v ON_ERROR_STOP=1 -f logistics.sql && psql -d hl_perf -v ON_ERROR_STOP=1 -f explain-logistics.sql
-- Seeding is deterministic (setseed + md5-derived ids). Triggers are bypassed with session_replication_role = replica
-- (the data is consistent by construction; constraints other than FK/triggers still apply), then VACUUM ANALYZE.
\set ON_ERROR_STOP on
\pset pager off
SELECT setseed(0.42);
SET session_replication_role = replica;

INSERT INTO item_type VALUES ('FOOD','Lương thực');
INSERT INTO unit VALUES ('PIECE','cái',0);
INSERT INTO item (id,item_type_code,unit_code,name)
  SELECT md5('item'||g)::uuid,'FOOD','PIECE','Mặt hàng '||g FROM generate_series(1,150) g;
-- 5 organizations x 4 warehouses
INSERT INTO warehouse (id,organization_id,region_code,name,status)
  SELECT md5('wh'||g)::uuid, md5('org'||(g%5))::uuid, 'R'||(g%7), 'Kho '||g, 'ACTIVE' FROM generate_series(0,19) g;
INSERT INTO stock_balance (id,warehouse_id,item_id)
  SELECT md5('bal'||w||'-'||i)::uuid, md5('wh'||w)::uuid, md5('item'||i)::uuid FROM generate_series(0,19) w, generate_series(1,150) i;

-- 200,000 ledger rows over 3,000 balances (OPENING only: shape-valid without extra parents)
INSERT INTO stock_movement (id,balance_id,movement_type,delta_on_hand,delta_reserved,operation_ref,actor_user_id,created_at)
  SELECT md5('mv'||g)::uuid, md5('bal'||(g%20)||'-'||(1+(g/20)%150))::uuid, 'OPENING', 1+(g%9), 0, 'seed-'||g, md5('actor'||(g%50))::uuid,
         now() - random()*90 * interval '1 day'
  FROM generate_series(1,200000) g;
UPDATE stock_balance b SET on_hand = s.t FROM (SELECT balance_id, sum(delta_on_hand) t FROM stock_movement GROUP BY 1) s WHERE s.balance_id = b.id;

-- 2,000 drives (30 % OPEN) and 50,000 deliveries
INSERT INTO donation_drive (id,organization_id,intake_warehouse_id,title,status,created_at)
  SELECT md5('drive'||g)::uuid, md5('org'||(g%5))::uuid, md5('wh'||(g%5 + 5*(g%4)))::uuid, 'Đợt '||g,
         CASE WHEN g%10 < 3 THEN 'OPEN' WHEN g%10 < 5 THEN 'PAUSED' ELSE 'CLOSED' END, now() - random()*365 * interval '1 day'
  FROM generate_series(1,2000) g;
INSERT INTO donation_delivery (id,public_code,drive_id,organization_id,donor_name,donor_phone,status,created_at)
  SELECT md5('dlv'||g)::uuid, upper(substr(md5('code'||g),1,12)), md5('drive'||(1+g%2000))::uuid, md5('org'||((1+g%2000)%5))::uuid, 'Người cho '||g, '09'||lpad((g%100000000)::text,8,'0'),
         (ARRAY['POSTED','POSTED','POSTED','POSTED','POSTED','POSTED','DECLARED','COUNTING','PENDING_REVIEW','APPROVED','REJECTED','CANCELLED'])[1+g%12],
         now() - random()*365 * interval '1 day'
  FROM generate_series(1,50000) g;

-- 20,000 cycles x 5 needs, 60,000 commitments
INSERT INTO fulfillment_cycle (id,request_id,work_cycle,organization_id,created_at)
  SELECT md5('cyc'||g)::uuid, md5('req'||g)::uuid, 1, md5('org'||(g%5))::uuid, now() - random()*180 * interval '1 day' FROM generate_series(1,20000) g;
INSERT INTO relief_need (id,cycle_id,item_id,original_quantity,requested_quantity)
  SELECT md5('need'||g||'-'||j)::uuid, md5('cyc'||g)::uuid, md5('item'||(1+(g+j*7)%150))::uuid, 10+j, 10+j FROM generate_series(1,20000) g, generate_series(0,4) j;
INSERT INTO commitment (id,relief_need_id,item_id,warehouse_id,quantity,created_by_user_id)
  SELECT md5('com'||g||'-'||j)::uuid, md5('need'||g||'-'||j)::uuid, md5('item'||(1+(g+j*7)%150))::uuid, md5('wh'||(g%5 + 5*(j%4)))::uuid, 5, md5('actor'||(g%50))::uuid
  FROM generate_series(1,20000) g, generate_series(0,2) j;

-- 20,000 distributions with 3 lines each
INSERT INTO distribution (id,warehouse_id,organization_id,purpose,status,preparer_user_id,approver_user_id,approved_version,approved_at,dispatch_actor_user_id,dispatched_at,reconciled_at,created_at)
  SELECT md5('dis'||g)::uuid, md5('wh'||(g%5 + 5*(g%4)))::uuid, md5('org'||(g%5))::uuid, 'CAMPAIGN_DISTRIBUTION',
         s.st, md5('prep'||g)::uuid,
         CASE WHEN s.st = 'DRAFT' OR s.st = 'CANCELLED' THEN NULL ELSE md5('appr'||g)::uuid END,
         CASE WHEN s.st = 'DRAFT' OR s.st = 'CANCELLED' THEN NULL ELSE 1 END,
         CASE WHEN s.st = 'DRAFT' OR s.st = 'CANCELLED' THEN NULL ELSE now() END,
         CASE WHEN s.st IN ('DISPATCHED','RECONCILED') THEN md5('disp'||g)::uuid END,
         CASE WHEN s.st IN ('DISPATCHED','RECONCILED') THEN now() END,
         CASE WHEN s.st = 'RECONCILED' THEN now() END,
         now() - random()*180 * interval '1 day'
  FROM generate_series(1,20000) g, LATERAL (SELECT (ARRAY['DRAFT','APPROVED','DISPATCHED','RECONCILED','RECONCILED','CANCELLED'])[1+g%6] st) s;
INSERT INTO distribution_line (id,distribution_id,warehouse_id,item_id,quantity)
  SELECT md5('dl'||g||'-'||j)::uuid, md5('dis'||g)::uuid, md5('wh'||(g%5 + 5*(g%4)))::uuid, md5('item'||(1+(g+j*11)%150))::uuid, 5 FROM generate_series(1,20000) g, generate_series(0,2) j;

RESET session_replication_role;
VACUUM (ANALYZE) ;
SELECT 'stock_movement' t, count(*) FROM stock_movement UNION ALL SELECT 'stock_balance', count(*) FROM stock_balance UNION ALL SELECT 'donation_delivery', count(*) FROM donation_delivery
UNION ALL SELECT 'donation_drive', count(*) FROM donation_drive UNION ALL SELECT 'distribution', count(*) FROM distribution UNION ALL SELECT 'distribution_line', count(*) FROM distribution_line
UNION ALL SELECT 'fulfillment_cycle', count(*) FROM fulfillment_cycle UNION ALL SELECT 'relief_need', count(*) FROM relief_need UNION ALL SELECT 'commitment', count(*) FROM commitment;

-- representative parameters (fixed by the seed)
SELECT id AS bal FROM stock_balance WHERE warehouse_id = md5('wh7')::uuid AND item_id = md5('item42')::uuid \gset
SELECT md5('wh7')::uuid AS wh, md5('org2')::uuid AS org, md5('cyc777')::uuid AS cyc \gset
-- keyset cursor = the 30th row of the first page (so the page-2 query has real work to skip)
SELECT created_at AS mv_ts, id AS mv_id FROM stock_movement WHERE balance_id = :'bal' ORDER BY created_at, id OFFSET 29 LIMIT 1 \gset
SELECT created_at AS dl_ts, id AS dl_id FROM donation_delivery WHERE organization_id = :'org' AND status IN ('DECLARED','COUNTING','PENDING_REVIEW','APPROVED') ORDER BY created_at, id OFFSET 49 LIMIT 1 \gset
SELECT created_at AS dr_ts, id AS dr_id FROM donation_drive WHERE status = 'OPEN' ORDER BY created_at DESC, id DESC OFFSET 19 LIMIT 1 \gset
SELECT created_at AS di_ts, id AS di_id FROM distribution WHERE organization_id = :'org' ORDER BY created_at, id OFFSET 49 LIMIT 1 \gset

\echo '=== Q1 ledger keyset page 2 by balance (movement_balance_idx) ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, movement_type, delta_on_hand, delta_reserved, created_at FROM stock_movement
WHERE balance_id = :'bal' AND (created_at, id) > (:'mv_ts', :'mv_id') ORDER BY created_at, id LIMIT 30;

\echo '=== Q2 reconciliation: ledger sums vs balance, one warehouse (index-only on movement_balance_idx) ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT b.id, b.on_hand, b.reserved, sum(m.delta_on_hand) AS ledger_on_hand, sum(m.delta_reserved) AS ledger_reserved
FROM stock_balance b JOIN stock_movement m ON m.balance_id = b.id
WHERE b.warehouse_id = :'wh' GROUP BY b.id HAVING b.on_hand <> sum(m.delta_on_hand) OR b.reserved <> sum(m.delta_reserved);

\echo '=== Q3 delivery work queue by organization, page 2 (delivery_work_idx) ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, public_code, status, created_at FROM donation_delivery
WHERE organization_id = :'org' AND status IN ('DECLARED','COUNTING','PENDING_REVIEW','APPROVED') AND (created_at, id) > (:'dl_ts', :'dl_id')
ORDER BY created_at, id LIMIT 50;

\echo '=== Q4 public drive list, page 2 (drive_public_idx) ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, title, created_at FROM donation_drive
WHERE status = 'OPEN' AND (created_at, id) < (:'dr_ts', :'dr_id') ORDER BY created_at DESC, id DESC LIMIT 20;

\echo '=== Q5 distribution list by organization, page 2 (distribution_scope_idx) ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, status, purpose, created_at FROM distribution
WHERE organization_id = :'org' AND (created_at, id) > (:'di_ts', :'di_id') ORDER BY created_at, id LIMIT 50;

\echo '=== Q5b distribution list by organization with a status filter (status is not in the index) ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT id, status, purpose, created_at FROM distribution
WHERE organization_id = :'org' AND status = 'DISPATCHED' ORDER BY created_at, id LIMIT 50;

\echo '=== Q6 fulfillment board by cycle: needs + commitments, no N+1 (need_cycle_idx, commitment_need_idx) ==='
EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT n.id, n.item_id, n.requested_quantity, n.status, c.id AS commitment_id, c.warehouse_id, c.quantity, c.issued_quantity
FROM relief_need n LEFT JOIN commitment c ON c.relief_need_id = n.id WHERE n.cycle_id = :'cyc' ORDER BY n.created_at, n.id;
