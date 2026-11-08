import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

// Run on the host against the primary Logistics database. CTE rows shadow table
// names for deterministic SQL coverage without inserts, temporary schemas or resets.
assert.ok(process.env.C48_LOGISTICS_DATABASE_URL, 'C48_LOGISTICS_DATABASE_URL is required');
const source = await readFile(new URL('../../apps/logistics/src/drives/drives-queries.service.ts', import.meta.url), 'utf8');
const sql = source.match(/`(SELECT di\.drive_id[\s\S]*?ORDER BY di\.drive_id,i\.name,di\.item_id)`/)?.[1];
assert.ok(sql, 'Drive item aggregate query must be found');
const drive = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const fixture = `WITH
 drive_item(drive_id,item_id,target_quantity,acceptance_note) AS (VALUES
   ('${drive}'::uuid,1,100::numeric,NULL::text),('${drive}'::uuid,2,40::numeric,NULL::text),
   ('${drive}'::uuid,3,20::numeric,NULL::text),('${other}'::uuid,1,500::numeric,NULL::text)),
 item(id,name,item_type_code,unit_code) AS (VALUES (1,'Gạo','FOOD','KG'),(2,'Chăn','OTHER','PIECE'),(3,'Nước','OTHER','PIECE')),
 item_type(code,display_name) AS (VALUES ('FOOD','Thực phẩm'),('OTHER','Vật tư')),
 unit(code,display_name,scale) AS (VALUES ('KG','kg',3),('PIECE','cái',0)),
 donation_delivery(id,drive_id) AS (VALUES (1,'${drive}'::uuid),(2,'${drive}'::uuid),(3,'${other}'::uuid)),
 donation_receipt(id,delivery_id) AS (VALUES (11,1),(12,2),(13,3)),
 stock_balance(id,item_id) AS (VALUES (21,1),(22,2),(23,3),(24,1)),
 stock_movement(receipt_id,balance_id,movement_type,delta_on_hand) AS (VALUES
   (11,21,'RECEIPT',2.5::numeric),(11,22,'RECEIPT',2::numeric),
   (11,21,'RECEIPT_HELD_RELEASE',1::numeric),(12,24,'RECEIPT',0.25::numeric),
   (11,22,'ISSUE',-1::numeric),(13,21,'RECEIPT',90::numeric))
 `;
const db = new Client({ connectionString: process.env.C48_LOGISTICS_DATABASE_URL });
await db.connect();
try {
  const { rows } = await db.query(fixture + sql, [[drive, other]]);
  const totals = new Map(rows.map(row => [`${row.drive_id}:${row.item_id}`, row.accepted_total]));
  assert.equal(Number(totals.get(`${drive}:1`)), 3.75, 'Rice includes only its receipts and held release, across balances');
  assert.equal(Number(totals.get(`${drive}:2`)), 2, 'Blankets must not receive rice totals or subtract later issues');
  assert.equal(Number(totals.get(`${drive}:3`)), 0, 'An item with no stock movements must remain zero');
  assert.equal(Number(totals.get(`${other}:1`)), 90, 'Different drives must remain isolated');
  const { rows: empty } = await db.query(fixture + sql, [[]]);
  assert.equal(empty.length, 0);
  console.log('PASS: real PostgreSQL drive aggregate — item/unit, receipt, drive, held release, multiple balances, zero and empty isolation');
  // Independently reconcile the running API against the existing primary ledger.
  const base = process.env.C48_API_BASE_URL || 'http://127.0.0.1:8080/api/v1';
  const response = await fetch(`${base}/logistics/public/donation-drives?limit=100`);
  assert.equal(response.status, 200);
  const page = await response.json();
  let checked = 0;
  for (const entry of page.items) {
    const expected = await db.query(
      `SELECT sb.item_id,SUM(sm.delta_on_hand)::text AS total
         FROM stock_movement sm JOIN stock_balance sb ON sb.id=sm.balance_id
         JOIN donation_receipt r ON r.id=sm.receipt_id JOIN donation_delivery dd ON dd.id=r.delivery_id
        WHERE dd.drive_id=$1 AND sm.movement_type IN ('RECEIPT','RECEIPT_HELD_RELEASE') GROUP BY sb.item_id`,
      [entry.id],
    );
    const byItem = new Map(expected.rows.map(row => [row.item_id, row.total]));
    const detailResponse = await fetch(`${base}/logistics/public/donation-drives/${entry.id}`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();
    for (const line of entry.items) {
      assert.equal(Number(line.accepted_total), Number(byItem.get(line.item_id) || 0), 'Public list must match the item ledger');
      assert.equal(detail.items.find(item => item.item_id === line.item_id)?.accepted_total, line.accepted_total,
        'Public detail and list must agree');
      checked++;
    }
  }
  assert.ok(checked > 0, 'Existing public drive data must be exercised');
  console.log(`PASS: running public list/detail reconciled ${checked} item totals against the primary ledger; further pages: ${Boolean(page.more)}`);
} finally { await db.end(); }
