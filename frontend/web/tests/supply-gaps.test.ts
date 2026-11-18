import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAcceptSupplyGap,
  canDismissSupplyGap,
  canManageCampaignWarehouses,
  canManageNeedNorms,
  canManageSupplyGaps,
  canViewSupplyGapWarnings,
  distanceLabel,
  isoToLocalInput,
  summarizeSupplyGapWarnings,
  warningTone,
  type SupplyGap,
} from '../src/features/supply-gaps/supplyModel.ts';
import {
  labelFor,
  needReasonLabels,
  needSourceLabels,
  severityLabels,
  severityTones,
  supplyGapStatusLabels,
  supplyGapStatusTones,
} from '../src/i18n/supplyLabels.ts';

const gap = (overrides: Partial<SupplyGap>): SupplyGap => ({
  id: '00000000-0000-4000-8000-000000000001',
  status: 'OPEN',
  severity: 'RED',
  warehouse_id: '00000000-0000-4000-8000-0000000000aa',
  warehouse_name: 'Kho A',
  item_id: '00000000-0000-4000-8000-0000000000bb',
  item_name: 'Nước uống',
  unit_code: 'L',
  scale: 0,
  demand: '10',
  supply: '4',
  pledged: '0',
  gap_qty: '6',
  forecast_demand: '0',
  campaign_ids: [],
  backup_warehouse_ids: [],
  reason_codes: [],
  reasons: [],
  draft: {},
  drive_id: null,
  dismissed_reason: null,
  dismissed_until: null,
  computed_at: null,
  version: 1,
  created_at: null,
  updated_at: null,
  ...overrides,
});

test('status, severity and need source map to Vietnamese labels and stable tones', () => {
  assert.equal(labelFor(supplyGapStatusLabels, 'OPEN', 'x'), 'Đang chờ xử lý');
  assert.equal(labelFor(supplyGapStatusLabels, 'ACCEPTED', 'x'), 'Đã tạo đợt quyên góp');
  assert.equal(labelFor(supplyGapStatusLabels, 'UNKNOWN_CODE', 'Chưa rõ trạng thái'), 'Chưa rõ trạng thái');
  assert.equal(labelFor(severityLabels, 'RED', ''), 'Đỏ');
  assert.equal(labelFor(severityLabels, 'YELLOW', ''), 'Vàng');
  assert.equal(severityTones.RED, 'danger');
  assert.equal(severityTones.YELLOW, 'warning');
  assert.equal(supplyGapStatusTones.ACCEPTED, 'success');
  assert.equal(labelFor(needSourceLabels, 'ESTIMATED', ''), 'Ước tính');
  assert.equal(labelFor(needSourceLabels, 'CONFIRMED', ''), 'Đã xác nhận');
  assert.equal(labelFor(needSourceLabels, 'DECLARED', ''), 'Khai báo');
});

test('every need reason code known to the backend has Vietnamese copy', () => {
  // Mirrors backend NEED_REASON_CODES (apps/logistics/src/needs/need-reasons.ts).
  const backendCodes = [
    'NORM_PER_PERSON_DAY', 'NORM_PER_PERSON', 'DAYS_DEFAULT', 'INFANT_MODIFIER_APPLIED',
    'ELDERLY_MODIFIER_APPLIED', 'ROUNDED_UP_TO_UNIT_SCALE', 'NORM_NOT_FOUND', 'QUANTITY_FAR_ABOVE_ESTIMATE',
  ];
  assert.deepEqual(Object.keys(needReasonLabels).sort(), [...backendCodes].sort());
  assert.match(needReasonLabels.QUANTITY_FAR_ABOVE_ESTIMATE, /3 lần/);
});

test('role gating: only managers act; coordinators see warnings but no actions', () => {
  const manager = new Set(['OPERATIONS_MANAGER']);
  const coordinator = new Set(['COORDINATOR']);
  const reviewer = new Set(['REVIEWER']);
  assert.equal(canManageSupplyGaps(manager), true);
  assert.equal(canManageSupplyGaps(coordinator), false);
  assert.equal(canManageSupplyGaps(reviewer), false);
  assert.equal(canViewSupplyGapWarnings(coordinator), true);
  assert.equal(canViewSupplyGapWarnings(manager), true);
  assert.equal(canViewSupplyGapWarnings(reviewer), false);
  assert.equal(canManageCampaignWarehouses(manager), true);
  assert.equal(canManageCampaignWarehouses(coordinator), false);
  assert.equal(canManageNeedNorms(manager), true);
  assert.equal(canManageNeedNorms(coordinator), false);
});

test('accept is offered only for an OPEN RED gap; yellow is warning only; dismiss needs OPEN', () => {
  assert.equal(canAcceptSupplyGap(gap({ severity: 'RED', status: 'OPEN' })), true);
  assert.equal(canAcceptSupplyGap(gap({ severity: 'YELLOW', status: 'OPEN' })), false);
  assert.equal(canAcceptSupplyGap(gap({ severity: 'RED', status: 'ACCEPTED' })), false);
  assert.equal(canAcceptSupplyGap(gap({ severity: 'RED', status: 'DISMISSED' })), false);
  assert.equal(canDismissSupplyGap(gap({ severity: 'YELLOW', status: 'OPEN' })), true);
  assert.equal(canDismissSupplyGap(gap({ status: 'EXPIRED' })), false);
});

test('warning summary counts open gaps only and prefers RED for the tooltip', () => {
  const summary = summarizeSupplyGapWarnings([
    gap({ id: 'a', severity: 'YELLOW', gap_qty: '99' }),
    gap({ id: 'b', severity: 'RED', gap_qty: '2' }),
    gap({ id: 'c', severity: 'RED', gap_qty: '7' }),
    gap({ id: 'd', severity: 'RED', status: 'DISMISSED', gap_qty: '50' }),
  ]);
  assert.equal(summary.open, 3);
  assert.equal(summary.red, 2);
  assert.equal(summary.yellow, 1);
  assert.equal(summary.top?.id, 'c');
  assert.equal(warningTone(summary), 'danger');
  assert.equal(warningTone({ red: 0, yellow: 2 }), 'warning');
  assert.equal(warningTone({ red: 0, yellow: 0 }), 'neutral');
  assert.equal(summarizeSupplyGapWarnings([]).top, null);
});

test('datetime and distance helpers format without changing the value', () => {
  assert.equal(isoToLocalInput(null), '');
  assert.equal(isoToLocalInput('not a date'), '');
  const local = isoToLocalInput(new Date(2026, 10, 18, 7, 5).toISOString());
  assert.equal(local, '2026-11-18T07:05');
  assert.equal(distanceLabel(850), '850 m');
  assert.equal(distanceLabel(1500), '1,5 km');
  assert.equal(distanceLabel(Number.NaN), 'Chưa rõ khoảng cách');
});
