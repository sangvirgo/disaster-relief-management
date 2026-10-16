import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const helper = await import('../smoke/t17-fulfillment-report.mjs').catch(() => null);
const smokeSource = await readFile(new URL('../smoke/test-logistics-t17.mjs', import.meta.url), 'utf8');

const oracleRows = [
  {
    need_id: 'need-1', request_id: 'request-1', cycle_id: 'cycle-1', work_cycle: '2',
    region_code: 'R1', campaign_id: null, item_id: 'item-1', item_name: 'Gạo',
    unit_code: 'KG', unit_name: 'Kilôgam', unit_scale: '3', original: '10.000', reduced: '2.000',
    cancelled_remaining: '0.000', active_requested: '8.000', delivered: '3.000',
    active_outstanding: '5.000', status: 'IN_PROGRESS',
  },
  {
    need_id: 'need-2', request_id: 'request-2', cycle_id: 'cycle-2', work_cycle: 1,
    region_code: 'R1', campaign_id: 'campaign-1', item_id: 'item-2', item_name: 'Nước',
    unit_code: 'L', unit_name: 'Lít', unit_scale: 2, original: '12.00', reduced: '0.00',
    cancelled_remaining: '0.00', active_requested: '12.00', delivered: '12.00',
    active_outstanding: '0.00', status: 'RESOLVED',
  },
  {
    need_id: 'need-3', request_id: 'request-3', cycle_id: 'cycle-3', work_cycle: 1,
    region_code: 'R1', campaign_id: null, item_id: 'item-3', item_name: 'Chăn',
    unit_code: 'EA', unit_name: 'Cái', unit_scale: 0, original: '4', reduced: '0',
    cancelled_remaining: '0', active_requested: '4', delivered: '0',
    active_outstanding: '4', status: 'TRIAGED',
  },
];

function reportItem(row) {
  return {
    id: row.need_id,
    request_id: row.request_id,
    cycle_id: row.cycle_id,
    work_cycle: Number(row.work_cycle),
    region_code: row.region_code,
    campaign_id: row.campaign_id,
    item: { id: row.item_id, name: row.item_name },
    unit: { code: row.unit_code, display_name: row.unit_name, scale: Number(row.unit_scale) },
    original: row.original,
    reduced: row.reduced,
    cancelled_remaining: row.cancelled_remaining,
    active_requested: row.active_requested,
    delivered: row.delivered,
    active_outstanding: row.active_outstanding,
    status: row.status,
  };
}

test('T17 fulfillment smoke compares report pages with the primary-row oracle', () => {
  assert.equal(typeof helper?.assertFulfillmentReportPage, 'function', 'fulfillment report page comparison helper exists');
  assert.match(smokeSource, /const fulfillmentOracle = await logisticsDb\.query\(/u);
  assert.match(smokeSource, /assertFulfillmentReportPage\(fulfillment\.value, fulfillmentOracle\.rows, fulfillmentOffset, fulfillmentLimit\)/u);
  assert.match(smokeSource, /fulfillmentCursor/u);

  const { assertFulfillmentReportPage } = helper;
  const firstPage = { items: oracleRows.slice(0, 2).map(reportItem), more: true, cursor: 'opaque-page-2' };
  const secondPage = { items: oracleRows.slice(2).map(reportItem), more: false };

  assert.doesNotThrow(() => assertFulfillmentReportPage(firstPage, oracleRows, 0, 2));
  assert.doesNotThrow(() => assertFulfillmentReportPage(secondPage, oracleRows, 2, 2));
  assert.throws(
    () => assertFulfillmentReportPage({ ...firstPage, items: [reportItem(oracleRows[1]), reportItem(oracleRows[0])] }, oracleRows, 0, 2),
    /deep-equal/u,
  );
});
