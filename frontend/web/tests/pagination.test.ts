import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendPage } from '../src/api/pagination.ts';
import { operationRecordKey } from '../src/features/operations/recordKey.ts';

test('overlapping pages update existing rows, retain order and deduplicate incoming rows', () => {
  const initial = [{ id: 'a', version: 1 }, { id: 'b', version: 1 }];
  const incoming = [{ id: 'b', version: 2 }, { id: 'c', version: 1 }, { id: 'c', version: 2 }];
  assert.deepEqual(appendPage(initial, incoming, row => row.id), [
    { id: 'a', version: 1 }, { id: 'b', version: 2 }, { id: 'c', version: 2 },
  ]);
  assert.equal(initial[1].version, 1);
  assert.equal(incoming.length, 3);
});

test('stock balance pages do not collapse rows without an id property', () => {
  const rows = appendPage([{ balance_id: 'balance-a' }], [{ balance_id: 'balance-b' }], operationRecordKey);
  assert.equal(rows.length, 2);
});

test('aggregate identity distinguishes the same item across warehouses and survives quantity changes', () => {
  const a = { warehouse_id: 'a', item: { id: 'rice' }, available: '10' };
  const b = { warehouse_id: 'b', item: { id: 'rice' }, available: '10' };
  assert.notEqual(operationRecordKey(a), operationRecordKey(b));
  const merged = appendPage([a], [b, { ...a, available: '8' }], operationRecordKey);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].available, '8');
});

test('reconciliation items and fulfillment needs retain separate identities', () => {
  assert.notEqual(operationRecordKey({ item: { id: 'rice' } }), operationRecordKey({ item: { id: 'water' } }));
  assert.notEqual(operationRecordKey({ id: 'need-a', item: { id: 'rice' } }), operationRecordKey({ id: 'need-b', item: { id: 'rice' } }));
});
