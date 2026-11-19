import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposalPanelStatus } from '../src/features/coordinator/sosProposalStatus.ts';

test('an SOS that is not verified yet shows "Chờ xác minh"', () => {
  const status = proposalPanelStatus({ requestStatus: 'VERIFYING', needsReliefSupplies: true, lines: [] });
  assert.deepEqual(status, { visible: true, code: 'AWAITING_VERIFICATION', label: 'Chờ xác minh' });
  assert.equal(proposalPanelStatus({ requestStatus: 'SUBMITTED', needsReliefSupplies: true, lines: [] }).label, 'Chờ xác minh');
});

test('estimated lines show "Đang chờ quản lý duyệt"; confirmed lines show "Đã duyệt"', () => {
  const pending = proposalPanelStatus({
    requestStatus: 'VERIFIED', needsReliefSupplies: true,
    lines: [{ source: 'ESTIMATED', status: 'OPEN' }],
  });
  assert.equal(pending.label, 'Đang chờ quản lý duyệt');
  const confirmed = proposalPanelStatus({
    requestStatus: 'IN_PROGRESS', needsReliefSupplies: true,
    lines: [{ source: 'CONFIRMED', status: 'OPEN' }],
  });
  assert.equal(confirmed.label, 'Đã duyệt');
});

test('a verified SOS with no live proposal shows "Chưa có đề xuất"; cancelled lines do not count', () => {
  const none = proposalPanelStatus({
    requestStatus: 'TRIAGED', needsReliefSupplies: true,
    lines: [{ source: 'ESTIMATED', status: 'CANCELLED' }],
  });
  assert.deepEqual(none, { visible: true, code: 'NONE', label: 'Chưa có đề xuất' });
});

test('no relief need, or a closed SOS, shows nothing', () => {
  assert.equal(proposalPanelStatus({ requestStatus: 'VERIFIED', needsReliefSupplies: false, lines: [] }).visible, false);
  assert.equal(proposalPanelStatus({ requestStatus: 'CANCELLED', needsReliefSupplies: true, lines: [] }).visible, false);
});
