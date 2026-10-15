import { mapPostgresError } from '../../../packages/technical/src/persistence/postgres-errors';
import { assertIndependentAdjustmentReviewer, STOCK_ADJUSTMENT_ERROR_MAPPINGS, validateQuantity } from '../src/stock/stock.helpers';

describe('Logistics stock rules', () => {
  it('accepts decimal strings only within the unit scale and numeric(18,3) range', () => {
    expect(validateQuantity('12.50', 2)).toBe('12.50');
    expect(() => validateQuantity('1e2', 2)).toThrow();
    expect(() => validateQuantity('1.001', 2)).toThrow();
    expect(() => validateQuantity('1.0004', 0)).toThrow();
    expect(() => validateQuantity('1000000000000000', 0)).toThrow();
    expect(() => validateQuantity('0', 0)).toThrow();
  });

  it.each(['NaN', 'Infinity', '-Infinity'])('rejects non-finite quantity %s', (value) => {
    expect(() => validateQuantity(value, 2)).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED', status: 400 }));
  });

  it('allows signed adjustment deltas but rejects zero', () => {
    expect(validateQuantity('-1.25', 2, { allowNegative: true })).toBe('-1.25');
    expect(() => validateQuantity('0.00', 2, { allowNegative: true })).toThrow();
  });

  it('refuses self-review of a stock adjustment', () => {
    expect(() => assertIndependentAdjustmentReviewer('user-a', 'user-a')).toThrow(expect.objectContaining({ code: 'FORBIDDEN', status: 403 }));
    expect(() => assertIndependentAdjustmentReviewer('user-a', 'user-b')).not.toThrow();
  });

  it('maps a stock balance check failure to the adjustment conflict code', () => {
    const mapped = mapPostgresError(
      { code: '23514', constraint: 'stock_balance_reserved_check1' },
      STOCK_ADJUSTMENT_ERROR_MAPPINGS,
    );
    expect(mapped?.code).toBe('ADJUSTMENT_VIOLATES_RESERVED');
    expect(mapped?.status).toBe(409);
  });
});
