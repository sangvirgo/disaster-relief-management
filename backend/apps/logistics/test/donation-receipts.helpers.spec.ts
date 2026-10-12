import {
  assertHeldReleaseConserved, receiptLineFlags, receiptQuantityUnits, validateCountSplit,
} from '../src/receipts/donation-receipts.helpers';
import { ReceiptCountLineDto } from '../src/receipts/donation-receipts.dto';

const countLine: ReceiptCountLineDto = {
  item_id: 'item-1', counted_quantity: '2.30', accepted_quantity: '1.20', held_quantity: '1.00', rejected_quantity: '0.10',
};

function facts(overrides: Partial<Parameters<typeof receiptLineFlags>[0]> = {}): Parameters<typeof receiptLineFlags>[0] {
  return {
    item_id: 'item-1', counted_quantity: '2.30', accepted_quantity: '1.20', held_quantity: '1.00', rejected_quantity: '0.10',
    declared_quantity: '2.30', expiry_date: null, unit_scale: 2, has_count_line: true, ...overrides,
  };
}

describe('donation receipt count helpers', () => {
  it('compares count splits using exact scaled integers', () => {
    expect(() => validateCountSplit(countLine, 2)).not.toThrow();
    expect(() => validateCountSplit({ ...countLine, accepted_quantity: '1.21' }, 2)).toThrow('COUNT_SPLIT_MISMATCH');
  });

  it('derives matching and near-expiry flags without auto-approving', () => {
    const now = new Date('2026-10-12T00:00:00.000Z');
    expect(receiptLineFlags(facts({ expiry_date: '2026-11-01' }), now)).toEqual(['MATCH', 'EXPIRING_SOON']);
  });

  it('flags short declared items and unexpected counted items', () => {
    expect(receiptLineFlags(facts({ counted_quantity: '1.00', accepted_quantity: '1.00', held_quantity: '0', rejected_quantity: '0' })))
      .toContain('SHORT');
    expect(receiptLineFlags(facts({ declared_quantity: null }))).toContain('UNEXPECTED_ITEM');
  });

  it('ignores database-added trailing zeroes when checking the unit scale', () => {
    expect(receiptLineFlags(facts({
      counted_quantity: '8.000', accepted_quantity: '5.000', held_quantity: '2.000', rejected_quantity: '1.000',
      declared_quantity: '10.000',
    }))).toEqual(['SHORT']);
  });

  it('compares database numeric values after removing scale padding', () => {
    expect(receiptQuantityUnits('5.000', 2)).toBe(500n);
    expect(receiptQuantityUnits('0.000', 2)).toBe(0n);
  });

  it('trims only valid trailing decimal padding', () => {
    expect(receiptQuantityUnits('1.2300', 2)).toBe(123n);
    expect(() => receiptQuantityUnits('1.2301', 2)).toThrow('QUANTITY_SCALE_INVALID');
    expect(() => receiptQuantityUnits('1.0.000', 2)).toThrow('VALIDATION_FAILED');
  });

  it('accepts only conserved held-to-accepted revisions', () => {
    const previous = [facts({ counted_quantity: '5.00', accepted_quantity: '2.00', held_quantity: '3.00', rejected_quantity: '0' })];
    const released = [facts({ counted_quantity: '5.00', accepted_quantity: '3.25', held_quantity: '1.75', rejected_quantity: '0' })];
    expect(() => assertHeldReleaseConserved(previous, released)).not.toThrow();
    expect(() => assertHeldReleaseConserved(previous, [facts({ counted_quantity: '5.00', accepted_quantity: '3.00', held_quantity: '1.75', rejected_quantity: '0' })]))
      .toThrow('VALIDATION_FAILED');
  });

  it('reports invalid unit scale as a review flag without crashing the read', () => {
    expect(receiptLineFlags(facts({ counted_quantity: '2.301' }))).toContain('UNIT_OR_SCALE_ERROR');
  });
});
