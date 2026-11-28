import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSupplyLines } from '../src/features/supply/supplyDraft.ts';

test('a malformed visible line blocks all goods, including otherwise valid rows', () => {
  for (const quantity of ['', '0', '-1', 'NaN', 'Infinity', '1e3', '1.5', '1'.repeat(400)]) {
    const result = prepareSupplyLines([{ item_id: 'water', quantity: '28' }, { item_id: 'blanket', quantity }], () => 0);
    assert.equal(result.lines, null, quantity);
    assert.deepEqual(result.invalidItemIds, ['blanket']);
  }
});
test('valid decimal quantities and every selected item survive preparation without rounding', () => {
  const rows = [{ item_id: 'water', quantity: ' 28 ' }, { item_id: 'rice', quantity: '12.500' }];
  assert.deepEqual(prepareSupplyLines(rows, id => id === 'rice' ? 3 : 0).lines, [{ item_id: 'water', quantity: '28' }, { item_id: 'rice', quantity: '12.500' }]);
  assert.equal(rows[0].quantity, ' 28 ');
  assert.equal(prepareSupplyLines([], () => 0).lines, null);
  assert.equal(prepareSupplyLines(rows, () => -1).lines, null);
});
