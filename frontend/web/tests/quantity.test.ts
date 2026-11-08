import { test } from 'node:test';
import assert from 'node:assert/strict';
import { quantityFitsScale, remainingQuantity } from '../src/i18n/quantity.ts';

test('remaining quantity preserves decimal arithmetic and clamps over-target donations', () => {
  assert.equal(remainingQuantity('0.3', '0.1'), '0.2');
  assert.equal(remainingQuantity('100.000', '24.500'), '75.500');
  assert.equal(remainingQuantity('2', '3'), '0');
  assert.equal(remainingQuantity('9007199254740993.001', '0.001'), '9007199254740993.000');
});

test('invalid or incompatible quantities are not silently rounded into valid pieces', () => {
  assert.equal(quantityFitsScale('24.5', 0), false);
  assert.equal(quantityFitsScale('24.000', 0), true);
  assert.equal(quantityFitsScale('24.500', 3), true);
  assert.equal(quantityFitsScale('-1', 0), false);
  assert.equal(quantityFitsScale('Infinity', 0), false);
  assert.equal(remainingQuantity('100', '1e2'), null);
});
