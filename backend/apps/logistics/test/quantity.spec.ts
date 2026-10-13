import { quantityUnits, validateQuantity } from '../src/common/quantity';

describe('quantityUnits', () => {
  it('accepts fixed-scale database values with only trailing zeroes beyond unit scale', () => {
    expect(quantityUnits('10.000', 2)).toBe(1000n);
    expect(quantityUnits('1.200', 2)).toBe(120n);
    expect(quantityUnits('3.000', 0)).toBe(3n);
  });

  it('rejects stored values whose extra fractional digits change the quantity', () => {
    expect(() => quantityUnits('1.201', 2)).toThrow('QUANTITY_SCALE_INVALID');
  });

  it('keeps request validation strict at the unit scale', () => {
    expect(() => validateQuantity('10.000', 2)).toThrow('QUANTITY_SCALE_INVALID');
  });
});
