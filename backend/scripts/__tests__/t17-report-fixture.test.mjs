import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const smokeSource = readFileSync(new URL('../smoke/test-logistics-t17.mjs', import.meta.url), 'utf8');
const fulfillmentReport = await import('../smoke/t17-fulfillment-report.mjs');
const fixtureStart = smokeSource.indexOf('async function verifyPrimaryDatabaseReportFixture()');
const fixtureEnd = smokeSource.indexOf('\nasync function main()', fixtureStart);
assert.notEqual(fixtureStart, -1, 'T17 report fixture exists');
assert.notEqual(fixtureEnd, -1, 'T17 report fixture ends before the HTTP smoke');
const fixtureSource = smokeSource.slice(fixtureStart, fixtureEnd);
const reconciliationStart = smokeSource.indexOf('const reconciliation = await call(');
const fulfillmentStart = smokeSource.indexOf('const fulfillmentLimit =', reconciliationStart);
assert.notEqual(reconciliationStart, -1, 'T17 reconciliation endpoint check exists');
assert.notEqual(fulfillmentStart, -1, 'T17 reconciliation endpoint check ends before fulfillment');
const reconciliationSource = smokeSource.slice(reconciliationStart, fulfillmentStart);
const fulfillmentScopeStart = smokeSource.indexOf('const warehouses = await logisticsDb.query(');
const fulfillmentActorStart = smokeSource.indexOf('const actor = await loginSmokeActor', fulfillmentScopeStart);
assert.notEqual(fulfillmentScopeStart, -1, 'T17 fulfillment scope selection exists');
assert.notEqual(fulfillmentActorStart, -1, 'T17 actors are created after report scope selection');
const fulfillmentScopeSource = smokeSource.slice(fulfillmentScopeStart, fulfillmentActorStart);

test('T17 report fixture is SELECT-only and reuses production handoff predicates', () => {
  assert.match(fixtureSource, /\bWITH\b[\s\S]*\bVALUES\b/u);
  assert.match(fixtureSource, /physicalHandoffsLateralSql/u);
  assert.match(fixtureSource, /finalDistributionHandoffPredicate/u);
  assert.doesNotMatch(fixtureSource, /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\b/iu);
  assert.doesNotMatch(fixtureSource, /\b(?:BEGIN|COMMIT|ROLLBACK|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/iu);
});

test('T17 fulfillment smoke rejects an empty primary report oracle', () => {
  assert.throws(
    () => fulfillmentReport.assertFulfillmentReportPage({ items: [], more: false }, [], 0, 5),
    /requires populated fulfillment rows/u,
  );
});

test('T17 selects a recent populated fulfillment scope before registering smoke users', () => {
  assert.match(fulfillmentScopeSource, /fulfillment_need_count/u);
  assert.match(fulfillmentScopeSource, /ORDER BY fulfillment_need_count DESC/u);
  assert.match(fulfillmentScopeSource, /AND EXISTS \(SELECT 1 FROM stock_balance b WHERE b\.warehouse_id=w\.id\)/u);
  assert.match(fulfillmentScopeSource, /assert\.ok\(Number\(warehouse\?\.fulfillment_need_count\) > 0/u);
});

test('T17 reconciliation endpoint is deep-compared with a primary-row oracle', () => {
  assert.match(reconciliationSource, /await logisticsDb\.query/u);
  assert.match(reconciliationSource, /assert\.deepEqual\(reconciliation\.value\.items,/u);
  assert.match(reconciliationSource, /if \(reconciliationOracle\.rows\.length === 0\)/u);
  assert.match(reconciliationSource, /SKIP TC-REC-01 populated main-API evidence pending/u);
  assert.match(reconciliationSource, /assert\.deepEqual\(reconciliation\.value\.items, \[\]\)/u);
  assert.match(reconciliationSource, /assert\.equal\(reconciliation\.value\.more, false\)/u);
  for (const field of [
    'intake_accepted', 'posted_movements', 'posted_reserved_movements', 'reserved',
    'issued_in_transit', 'at_point', 'delivered', 'returned', 'lost',
    'balance_mismatch', 'commitment_counter_mismatch',
  ]) {
    assert.match(reconciliationSource, new RegExp(`\\b${field}\\b`, 'u'), `oracle compares ${field}`);
  }
});
