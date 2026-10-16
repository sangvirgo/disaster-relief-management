import assert from 'node:assert/strict';

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

export function assertFulfillmentReportPage(report, oracleRows, offset, limit) {
  assert.ok(oracleRows.length > 0, 'T17 smoke requires populated fulfillment rows');
  assert.deepEqual(report.items, oracleRows.slice(offset, offset + limit).map(reportItem));
  assert.equal(report.more, oracleRows.length > offset + limit);
  if (report.more) assert.equal(typeof report.cursor, 'string');
  else assert.equal(Object.hasOwn(report, 'cursor'), false);
}
