import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatQuantity, quantityInput, quantityFitsScale, remainingQuantity } from '../src/i18n/quantity.ts';
import { itemUnitName } from '../src/i18n/units.ts';

test('API padding does not turn nineteen pieces into nineteen thousand in display or inputs', () => {
  assert.equal(formatQuantity('19.000'), '19');
  assert.equal(quantityInput('19.000'), '19');
  assert.equal(quantityInput('15.500'), '15.5');
  assert.equal(quantityInput('9007199254740993.010'), '9007199254740993.01');
  assert.equal(formatQuantity('15000.000'), '15.000');
});

test('legacy package labels never convert quantities or override explicit units', () => {
  assert.equal(itemUnitName('00000000-0000-4000-8000-0000000a1003', 'cái'), 'chai');
  assert.equal(itemUnitName('00000000-0000-4000-8000-0000000a1002', 'cái'), 'gói');
  assert.equal(itemUnitName('00000000-0000-4000-8000-0000000a1003', 'thùng'), 'thùng');
  assert.equal(itemUnitName('other', 'cái'), 'cái');
});

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
