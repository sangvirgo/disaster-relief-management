import { AppError } from '@c48/technical/errors/errors';
import {
  estimateNeeds, NEED_ESTIMATE_DEFAULT_DAYS, NeedEstimateNorm, NeedEstimateInput, decimalUnits,
} from '../src/needs/need-estimate';
import { NEED_REASON_CODES, NEED_REASON_COPY, needReasonText } from '../src/needs/need-reasons';

const waterNorm: NeedEstimateNorm = {
  id: '10000000-0000-4000-8000-000000000001', category: 'WATER', item_type_code: 'NUOC_UONG',
  quantity_basis: 'PER_PERSON_DAY', qty_per_person_per_day: '3.000',
  modifier_infant: '0.50', modifier_elderly: '0.20', active: true, version: 2,
};
const foodNorm: NeedEstimateNorm = {
  id: '10000000-0000-4000-8000-000000000002', category: 'FOOD', item_type_code: 'LUONG_THUC',
  quantity_basis: 'PER_PERSON_DAY', qty_per_person_per_day: '0.600',
  modifier_infant: '0.00', modifier_elderly: '0.00', active: true, version: 1,
};
const blanketNorm: NeedEstimateNorm = {
  id: '10000000-0000-4000-8000-000000000003', category: 'BLANKET', item_type_code: 'CHAN_MEN',
  quantity_basis: 'PER_PERSON', qty_per_person_per_day: '1.000',
  modifier_infant: '0.00', modifier_elderly: '0.00', active: true, version: 1,
};
const medicineNorm: NeedEstimateNorm = {
  id: '10000000-0000-4000-8000-000000000004', category: 'MEDICINE', item_type_code: 'Y_TE',
  quantity_basis: 'PER_PERSON', qty_per_person_per_day: '0.010',
  modifier_infant: '0.00', modifier_elderly: '0.00', active: true, version: 1,
};
const norms = [waterNorm, foodNorm, blanketNorm, medicineNorm];

const water = (scale = 3) => ({ category: 'WATER', item_type_code: 'NUOC_UONG', unit_scale: scale });
const food = (scale = 3) => ({ category: 'FOOD', item_type_code: 'LUONG_THUC', unit_scale: scale });
const blanket = (scale = 0) => ({ category: 'BLANKET', item_type_code: 'CHAN_MEN', unit_scale: scale });
const medicine = (scale = 0) => ({ category: 'MEDICINE', item_type_code: 'Y_TE', unit_scale: scale });

function run(input: Partial<NeedEstimateInput> & Pick<NeedEstimateInput, 'people_count' | 'categories'>, table = norms) {
  return estimateNeeds(input, table);
}

function expectInvalid(input: Partial<NeedEstimateInput> & Pick<NeedEstimateInput, 'people_count' | 'categories'>) {
  let caught: unknown;
  try {
    run(input);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AppError);
  expect((caught as AppError).code).toBe('VALIDATION_FAILED');
}

describe('estimateNeeds', () => {
  it('multiplies people, days and the per-person-per-day norm exactly', () => {
    const result = run({ people_count: 10, days: 3, categories: [water()] });
    expect(result.skipped).toEqual([]);
    expect(result.lines).toEqual([expect.objectContaining({
      category: 'WATER', item_type_code: 'NUOC_UONG', norm_id: waterNorm.id, norm_version: 2,
      unit_scale: 3, quantity: '90.000', raw_quantity: '90.00000', days: 3, effective_persons: '10.00',
      reason_codes: ['NORM_PER_PERSON_DAY'],
    })]);
  });

  it('defaults the horizon to three days and says so in the reason codes', () => {
    expect(NEED_ESTIMATE_DEFAULT_DAYS).toBe(3);
    const line = run({ people_count: 10, categories: [water()] }).lines[0]!;
    expect(line.days).toBe(3);
    expect(line.quantity).toBe('90.000');
    expect(line.reason_codes).toEqual(['NORM_PER_PERSON_DAY', 'DAYS_DEFAULT']);
  });

  it('does not report a defaulted horizon when the caller provided days', () => {
    const line = run({ people_count: 10, days: 1, categories: [water()] }).lines[0]!;
    expect(line.reason_codes).not.toContain('DAYS_DEFAULT');
  });

  it('rounds up to the item unit scale, never down', () => {
    // 0.6 kg for one person for one day: 0.600 needed, so a whole-piece item needs 1
    const piece = run({ people_count: 1, days: 1, categories: [food(0)] }).lines[0]!;
    expect(piece.quantity).toBe('1');
    expect(piece.raw_quantity).toBe('0.60000');
    expect(piece.reason_codes).toContain('ROUNDED_UP_TO_UNIT_SCALE');

    // 0.6 kg is already exact on a 3-decimal scale
    const kilo = run({ people_count: 1, days: 1, categories: [food(3)] }).lines[0]!;
    expect(kilo.quantity).toBe('0.600');
    expect(kilo.reason_codes).not.toContain('ROUNDED_UP_TO_UNIT_SCALE');
  });

  it('rounds a fraction just above a whole unit up to the next unit', () => {
    // medicine 0.01 per person: 100 people -> exactly 1, 101 people -> 1.01 -> 2
    expect(run({ people_count: 100, categories: [medicine()] }).lines[0]!.quantity).toBe('1');
    const line = run({ people_count: 101, categories: [medicine()] }).lines[0]!;
    expect(line.quantity).toBe('2');
    expect(line.raw_quantity).toBe('1.01000');
    expect(line.reason_codes).toContain('ROUNDED_UP_TO_UNIT_SCALE');
  });

  it('never returns a zero quantity for a positive input', () => {
    const line = run({ people_count: 1, categories: [medicine()] }).lines[0]!;
    expect(line.quantity).toBe('1');
  });

  it('adds the infant and elderly modifiers as extra shares of the norm per person', () => {
    // 10 people, 2 infants (+0.50 each), 4 elderly (+0.20 each): 11.80 effective persons
    const line = run({ people_count: 10, days: 3, infants: 2, elderly: 4, categories: [water()] }).lines[0]!;
    expect(line.effective_persons).toBe('11.80');
    expect(line.quantity).toBe('106.200');
    expect(line.raw_quantity).toBe('106.20000');
    expect(line.reason_codes).toEqual(['NORM_PER_PERSON_DAY', 'INFANT_MODIFIER_APPLIED', 'ELDERLY_MODIFIER_APPLIED']);
  });

  it('ignores a modifier whose value is zero even when such people exist', () => {
    const line = run({ people_count: 5, days: 1, elderly: 2, categories: [food(3)] }).lines[0]!;
    expect(line.effective_persons).toBe('5.00');
    expect(line.reason_codes).not.toContain('ELDERLY_MODIFIER_APPLIED');
  });

  it('counts infants with the infant modifier only, leaving the people total unchanged', () => {
    const line = run({ people_count: 1, days: 1, infants: 1, categories: [water(3)] }).lines[0]!;
    expect(line.effective_persons).toBe('1.50');
    expect(line.quantity).toBe('4.500');
    expect(line.reason_codes).toContain('INFANT_MODIFIER_APPLIED');
  });

  it('does not multiply a per-person norm by the number of days', () => {
    const line = run({ people_count: 10, days: 7, categories: [blanket()] }).lines[0]!;
    expect(line.quantity).toBe('10');
    expect(line.days).toBe(1);
    expect(line.reason_codes).toEqual(['NORM_PER_PERSON']);
  });

  it('does not report a default horizon for a per-person norm', () => {
    const line = run({ people_count: 10, categories: [blanket()] }).lines[0]!;
    expect(line.reason_codes).toEqual(['NORM_PER_PERSON']);
  });

  it('applies the modifiers to per-person norms too', () => {
    const modified = { ...blanketNorm, modifier_infant: '1.00' };
    const line = run({ people_count: 4, infants: 2, categories: [blanket()] }, [modified]).lines[0]!;
    expect(line.effective_persons).toBe('6.00');
    expect(line.quantity).toBe('6');
    expect(line.reason_codes).toEqual(['NORM_PER_PERSON', 'INFANT_MODIFIER_APPLIED']);
  });

  it('skips a category whose norm is inactive instead of estimating from it', () => {
    const inactive = { ...foodNorm, active: false };
    const result = run({ people_count: 10, categories: [food(), water()] }, [inactive, waterNorm]);
    expect(result.lines.map((line) => line.category)).toEqual(['WATER']);
    expect(result.skipped).toEqual([{ category: 'FOOD', item_type_code: 'LUONG_THUC', reason_codes: ['NORM_NOT_FOUND'] }]);
  });

  it('skips an unknown category and reports NORM_NOT_FOUND', () => {
    const result = run({ people_count: 10, categories: [{ category: 'FUEL', item_type_code: 'NUOC_UONG', unit_scale: 0 }] });
    expect(result.lines).toEqual([]);
    expect(result.skipped).toEqual([{ category: 'FUEL', item_type_code: 'NUOC_UONG', reason_codes: ['NORM_NOT_FOUND'] }]);
  });

  it('does not match a norm of the same category under a different item type', () => {
    const result = run({ people_count: 10, categories: [{ category: 'WATER', item_type_code: 'LUONG_THUC', unit_scale: 3 }] });
    expect(result.lines).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });

  it('returns no lines for an empty category list', () => {
    expect(run({ people_count: 10, categories: [] })).toEqual({ lines: [], skipped: [] });
  });

  it('keeps the category order of the input', () => {
    const result = run({ people_count: 2, categories: [medicine(), water(), blanket()] });
    expect(result.lines.map((line) => line.category)).toEqual(['MEDICINE', 'WATER', 'BLANKET']);
  });

  it.each([
    ['zero people', { people_count: 0 }],
    ['negative people', { people_count: -1 }],
    ['fractional people', { people_count: 1.5 }],
    ['people above the limit', { people_count: 10_001 }],
    ['zero days', { people_count: 1, days: 0 }],
    ['days above the limit', { people_count: 1, days: 31 }],
    ['fractional days', { people_count: 1, days: 1.5 }],
    ['negative infants', { people_count: 5, infants: -1 }],
    ['infants and elderly above people', { people_count: 5, infants: 3, elderly: 3 }],
  ])('rejects %s with VALIDATION_FAILED', (_label, extra) => {
    expectInvalid({ categories: [water()], ...extra });
  });

  it('rejects a unit scale outside 0..3', () => {
    expectInvalid({ people_count: 1, categories: [{ category: 'WATER', item_type_code: 'NUOC_UONG', unit_scale: 4 }] });
  });

  it('rejects the same category twice for the same item type', () => {
    expectInvalid({ people_count: 1, categories: [water(), water()] });
  });

  it('rejects a norm with more decimals than its column allows', () => {
    const broken = { ...waterNorm, qty_per_person_per_day: '3.0004' };
    expect(() => run({ people_count: 1, categories: [water()] }, [broken])).toThrow(AppError);
  });

  it('rejects a norm whose quantity is zero so no zero-quantity line can be inserted', () => {
    const broken = { ...waterNorm, qty_per_person_per_day: '0.000' };
    expect(() => run({ people_count: 1, categories: [water()] }, [broken])).toThrow(AppError);
  });
});

describe('decimalUnits', () => {
  it('parses decimals into scaled integers', () => {
    expect(decimalUnits('0.5', 3)).toBe(500n);
    expect(decimalUnits('12', 2)).toBe(1200n);
    expect(decimalUnits('0.01', 2)).toBe(1n);
  });

  it('rejects malformed or over-precise values', () => {
    expect(() => decimalUnits('-1', 2)).toThrow(AppError);
    expect(() => decimalUnits('1.234', 2)).toThrow(AppError);
    expect(() => decimalUnits('', 2)).toThrow(AppError);
  });
});

describe('need reason copy', () => {
  it('has non-empty Vietnamese copy for every stable reason code', () => {
    for (const code of NEED_REASON_CODES) {
      expect(NEED_REASON_COPY[code].trim().length).toBeGreaterThan(0);
      expect(needReasonText(code)).toBe(NEED_REASON_COPY[code]);
    }
  });

  it('uses Vietnamese diacritics rather than English text', () => {
    for (const code of NEED_REASON_CODES) {
      expect(NEED_REASON_COPY[code]).toMatch(/[ăâđêôơưáàảãạéèẻẽẹíìỉĩịóòỏõọúùủũụýỳỷỹỵ]/iu);
    }
  });
});
