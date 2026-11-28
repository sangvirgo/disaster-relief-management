import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearAllCountDrafts, clearCountDraft, readCountDraft, writeCountDraft, type CountDraft, type CountDraftScope } from '../src/features/operations/countDraft.ts';

let records: Map<string, string>;
beforeEach(() => {
  records = new Map();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    get length() { return records.size; },
    key: (index: number) => [...records.keys()][index] ?? null,
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value); },
    removeItem: (key: string) => { records.delete(key); },
  } });
});
const scope: CountDraftScope = { userId: 'reviewer-a', deliveryId: 'delivery-a', version: 3, mode: 'confirm', countRevision: 1, declarationRevision: 1 };
const draft: CountDraft = { lines: [{ item_id: 'blanket', counted_quantity: '4', accepted_quantity: '3', held_quantity: '1', rejected_quantity: '0', condition_note: 'Một chăn cần kiểm tra lại', expiry_date: '' }], note: 'Đếm tại kho', advanced: true, allowUnexpected: false, touched: { '0.accepted_quantity': true }, evidenceName: '' };

test('independent counters, receipts and revisions cannot restore each other’s figures', () => {
  writeCountDraft(scope, draft);
  for (const changed of [{ userId: 'reviewer-b' }, { deliveryId: 'delivery-b' }, { version: 4 }, { mode: 'count' }, { countRevision: 2 }, { declarationRevision: 2 }])
    assert.equal(readCountDraft({ ...scope, ...changed }), null);
  assert.deepEqual(readCountDraft(scope), draft);
});

test('restoring a draft retains the author’s custom split and edit ownership', () => {
  assert.equal(writeCountDraft(scope, draft), true);
  assert.deepEqual(readCountDraft(scope), draft);
  const reordered = { mode: scope.mode, userId: scope.userId, version: scope.version, deliveryId: scope.deliveryId, declarationRevision: 1, countRevision: 1 };
  assert.deepEqual(readCountDraft(reordered), draft);
});

test('successful submit clears only its draft; logout clears all count drafts only', () => {
  const other = { ...scope, deliveryId: 'delivery-b' };
  writeCountDraft(scope, draft); writeCountDraft(other, draft);
  records.set('unrelated-preference', 'keep');
  clearCountDraft(scope);
  assert.equal(readCountDraft(scope), null);
  assert.deepEqual(readCountDraft(other), draft);
  clearAllCountDrafts();
  assert.equal(readCountDraft(other), null);
  assert.equal(records.get('unrelated-preference'), 'keep');
});

test('expired and malformed drafts are discarded instead of becoming count commands', () => {
  writeCountDraft(scope, draft);
  const key = [...records.keys()][0];
  records.set(key, JSON.stringify({ savedAt: Date.now() - 31 * 60_000, draft }));
  assert.equal(readCountDraft(scope), null);
  records.set(key, JSON.stringify({ savedAt: Date.now(), draft: { ...draft, lines: [{ item_id: 'blanket', counted_quantity: 4 }] } }));
  assert.equal(readCountDraft(scope), null);
  assert.equal(records.size, 0);
});

test('storage failure leaves saving unsuccessful so the form can retain its leave warning', () => {
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('Storage disabled'); } });
  assert.equal(writeCountDraft(scope, draft), false);
  assert.equal(readCountDraft(scope), null);
  assert.doesNotThrow(clearAllCountDrafts);
});

test('a draft too large to restore is never reported as saved', () => {
  assert.equal(writeCountDraft(scope, { ...draft, note: 'x'.repeat(200_001) }), false);
  assert.equal(records.size, 0);
});
