import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deadlineText, isUrgent, linesSummary, normalizePickupCode, quantityText, supplyStatusLabels,
} from '../src/features/supply/supplyModel.ts';

const now = Date.parse('2026-11-26T08:00:00.000Z');

test('deadline copy counts down in Vietnamese and flags the last hour', () => {
  assert.equal(deadlineText('2026-11-26T08:20:00.000Z', now), 'Còn 20 phút');
  assert.equal(deadlineText('2026-11-26T10:15:00.000Z', now), 'Còn 2 giờ 15 phút');
  assert.equal(deadlineText('2026-11-26T11:00:00.000Z', now), 'Còn 3 giờ');
  assert.equal(deadlineText('2026-11-26T07:59:00.000Z', now), 'Đã quá hạn nhận');
  assert.equal(isUrgent('2026-11-26T08:59:00.000Z', now), true);
  assert.equal(isUrgent('2026-11-26T09:30:00.000Z', now), false);
});

test('pickup codes keep six digits only', () => {
  assert.equal(normalizePickupCode(' 52-79 13 '), '527913');
  assert.equal(normalizePickupCode('1234567890'), '123456');
  assert.equal(normalizePickupCode('abc'), '');
});

test('goods read as Vietnamese quantities with their unit', () => {
  assert.equal(quantityText('12.500', 'kg'), '12,5 kg');
  assert.equal(linesSummary([{ item_name: 'Gạo', quantity: '20', unit_name: 'kg' }, { item_name: 'Nước', quantity: '40', unit_name: 'chai' }]),
    'Gạo 20 kg · +1 mặt hàng');
  assert.equal(linesSummary([]), 'Không còn hàng để giao');
});

test('every status has Vietnamese copy', () => {
  for (const status of ['READY', 'HANDED_OVER', 'CANCELLED', 'EXPIRED'] as const) assert.match(supplyStatusLabels[status], /\p{L}/u);
});
