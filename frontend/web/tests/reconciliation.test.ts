import test from 'node:test';
import assert from 'node:assert/strict';
import { reconciliationResult } from '../src/features/operations/reconciliationModel.ts';

test('missing or partial audit flags never announce matched stock', () => {
  for (const flags of [undefined, null, {}, { balance_mismatch: false }, { commitment_counter_mismatch: false }])
    assert.equal(reconciliationResult(flags).tone, 'muted');
});
test('both counters must explicitly match; each discrepancy has a distinct explanation', () => {
  assert.equal(reconciliationResult({ balance_mismatch: false, commitment_counter_mismatch: false }).text, 'Khớp số liệu');
  assert.equal(reconciliationResult({ balance_mismatch: true, commitment_counter_mismatch: false }).text, 'Chênh lệch sổ kho');
  assert.equal(reconciliationResult({ balance_mismatch: false, commitment_counter_mismatch: true }).text, 'Chênh lệch xuất và giao hàng');
  assert.equal(reconciliationResult({ balance_mismatch: true, commitment_counter_mismatch: true }).tone, 'warning');
});
