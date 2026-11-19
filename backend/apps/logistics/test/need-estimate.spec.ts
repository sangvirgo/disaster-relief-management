import { describe, expect, it } from '@jest/globals';
import {
  estimateNeeds, NEED_ESTIMATE_MAX_PEOPLE, NeedEstimateItem, NeedEstimateNorm,
} from '../src/needs/need-estimate';
import { NEED_REASON_CODES, NEED_REASON_COPY, needReasonText } from '../src/needs/need-reasons';

const water: NeedEstimateItem = { id: '00000000-0000-4000-8000-00000000a001', item_type_code: 'NUOC_UONG', unit_scale: 0, status: 'ACTIVE' };
const waterLiter: NeedEstimateItem = { id: '00000000-0000-4000-8000-00000000a002', item_type_code: 'NUOC_UONG', unit_scale: 3, status: 'ACTIVE' };
const rice: NeedEstimateItem = { id: '00000000-0000-4000-8000-00000000a003', item_type_code: 'LUONG_THUC', unit_scale: 3, status: 'ACTIVE' };
const blanket: NeedEstimateItem = { id: '00000000-0000-4000-8000-00000000a004', item_type_code: 'CHAN_MEN', unit_scale: 0, status: 'ACTIVE' };
const kit: NeedEstimateItem = { id: '00000000-0000-4000-8000-00000000a005', item_type_code: 'Y_TE', unit_scale: 0, status: 'ACTIVE' };
const items = [water, waterLiter, rice, blanket, kit];

function norm(overrides: Partial<NeedEstimateNorm> & Pick<NeedEstimateNorm, 'category' | 'item_type_code'>): NeedEstimateNorm {
  return {
    id: `norm-${overrides.category}`,
    quantity_basis: 'BY_GROUP',
    qty_adult: '0.000',
    qty_child: '0.000',
    qty_elderly: '0.000',
    people_per_unit: null,
    fixed_quantity: null,
    default_item_id: null,
    active: true,
    version: 1,
    ...overrides,
  };
}

const waterNorm = norm({
  category: 'WATER', item_type_code: 'NUOC_UONG', default_item_id: water.id,
  qty_adult: '3.000', qty_child: '1.000', qty_elderly: '2.000',
});
const foodNorm = norm({
  category: 'FOOD', item_type_code: 'LUONG_THUC', default_item_id: rice.id,
  qty_adult: '2.000', qty_child: '1.000', qty_elderly: '1.000',
});
const blanketNorm = norm({
  category: 'BLANKET', item_type_code: 'CHAN_MEN', quantity_basis: 'PER_N_PEOPLE', people_per_unit: 2, default_item_id: blanket.id,
});
const medicineNorm = norm({
  category: 'MEDICINE', item_type_code: 'Y_TE', quantity_basis: 'PER_REQUEST', fixed_quantity: '1.000', default_item_id: kit.id,
});
const norms = [waterNorm, foodNorm, blanketNorm, medicineNorm];

function estimate(people: number, children: number, elderly: number, lines = [{ category: 'WATER' }], table = norms) {
  return estimateNeeds({ people, children, elderly, lines }, table, items);
}

function expectCode(action: () => unknown, code: string, status?: number): void {
  let caught: unknown;
  try { action(); } catch (error) { caught = error; }
  expect(caught).toMatchObject(status === undefined ? { code } : { code, status });
}

describe('need estimate (pure rule)', () => {
  describe('BY_GROUP basis', () => {
    it('derives adults as people minus children minus elderly and applies each group norm', () => {
      const result = estimate(10, 3, 2);
      expect(result.skipped).toEqual([]);
      expect(result.lines).toHaveLength(1);
      const line = result.lines[0]!;
      // 5 adults * 3 + 3 children * 1 + 2 elderly * 2 = 22 litres (item scale 0 => whole units)
      expect(line.quantity).toBe('22');
      expect(line.estimate_basis.basis).toBe('BY_GROUP');
      expect(line.estimate_basis.inputs).toMatchObject({ people: 10, children: 3, elderly: 2, adults: 5, raw_quantity: '22.000' });
      expect(line.reason_codes).toEqual(['NORM_BY_GROUP', 'DEFAULT_ITEM_USED']);
    });

    it('treats an all-adult SOS as adults only', () => {
      const line = estimate(4, 0, 0).lines[0]!;
      expect(line.quantity).toBe('12');
      expect(line.estimate_basis.inputs.adults).toBe(4);
    });

    it('accepts children plus elderly equal to people (no adults left)', () => {
      // 2 children * 1 + 1 elderly * 2 = 4
      expect(estimate(3, 2, 1).lines[0]!.quantity).toBe('4');
      expect(estimate(3, 2, 1).lines[0]!.estimate_basis.inputs.adults).toBe(0);
    });

    it('rejects children plus elderly greater than people', () => {
      expectCode(() => estimate(3, 2, 2), 'VALIDATION_FAILED', 400);
    });

    it('rejects a people count outside 1..NEED_ESTIMATE_MAX_PEOPLE and negative group counts', async () => {
      expectCode(() => estimate(0, 0, 0), 'VALIDATION_FAILED', 400);
      expectCode(() => estimate(NEED_ESTIMATE_MAX_PEOPLE + 1, 0, 0), 'VALIDATION_FAILED', 400);
      expectCode(() => estimate(5, -1, 0), 'VALIDATION_FAILED', 400);
      expectCode(() => estimate(5, 0, 1.5), 'VALIDATION_FAILED', 400);
    });
  });

  describe('rounding up to the unit scale', () => {
    const rounding = norm({
      category: 'RICE_TEST', item_type_code: 'LUONG_THUC', qty_adult: '0.250', qty_child: '0.000', qty_elderly: '0.000',
      default_item_id: rice.id,
    });
    const at = (scale: number) => {
      const itemAtScale: NeedEstimateItem = { ...rice, id: `item-${scale}`, unit_scale: scale };
      return estimateNeeds(
        { people: 3, children: 0, elderly: 0, lines: [{ category: 'RICE_TEST', item_id: itemAtScale.id }] },
        [rounding], [itemAtScale],
      ).lines[0]!;
    };

    it('rounds 0.750 up to 1 at scale 0', () => {
      expect(at(0).quantity).toBe('1');
      expect(at(0).reason_codes).toEqual(['NORM_BY_GROUP', 'ROUNDED_UP_TO_UNIT_SCALE']);
    });

    it('rounds 0.750 up to 0.8 at scale 1', () => {
      expect(at(1).quantity).toBe('0.8');
    });

    it('rounds 0.750 up to 0.75 at scale 2 and keeps 0.750 exact at scale 3', () => {
      expect(at(2).quantity).toBe('0.75');
      expect(at(3).quantity).toBe('0.750');
      expect(at(3).reason_codes).toEqual(['NORM_BY_GROUP']);
    });

    it('never rounds an exact quantity', () => {
      const line = estimate(10, 0, 0, [{ category: 'WATER' }]).lines[0]!;
      expect(line.quantity).toBe('30');
      expect(line.reason_codes).not.toContain('ROUNDED_UP_TO_UNIT_SCALE');
    });
  });

  describe('PER_N_PEOPLE basis', () => {
    it('divides people by people_per_unit and rounds up', () => {
      expect(estimate(5, 0, 0, [{ category: 'BLANKET' }]).lines[0]!.quantity).toBe('3');
      expect(estimate(4, 0, 0, [{ category: 'BLANKET' }]).lines[0]!.quantity).toBe('2');
      expect(estimate(1, 0, 0, [{ category: 'BLANKET' }]).lines[0]!.quantity).toBe('1');
    });

    it('uses one blanket count for the whole SOS regardless of groups', () => {
      const line = estimate(6, 4, 2, [{ category: 'BLANKET' }]).lines[0]!;
      expect(line.quantity).toBe('3');
      expect(line.reason_codes).toEqual(['NORM_PER_N_PEOPLE', 'DEFAULT_ITEM_USED']);
      expect(line.estimate_basis.inputs).toMatchObject({ people_per_unit: 2, people: 6 });
    });
  });

  describe('PER_REQUEST basis', () => {
    it('returns the fixed quantity once per SOS', () => {
      const line = estimate(40, 10, 5, [{ category: 'MEDICINE' }]).lines[0]!;
      expect(line.quantity).toBe('1');
      expect(line.reason_codes).toEqual(['NORM_PER_REQUEST', 'DEFAULT_ITEM_USED']);
    });

    it('rounds a fractional fixed quantity up to the unit scale', () => {
      const fractional = norm({
        category: 'MEDICINE', item_type_code: 'Y_TE', quantity_basis: 'PER_REQUEST', fixed_quantity: '0.250', default_item_id: kit.id,
      });
      const line = estimate(2, 0, 0, [{ category: 'MEDICINE' }], [fractional]).lines[0]!;
      expect(line.quantity).toBe('1');
      expect(line.reason_codes).toEqual(['NORM_PER_REQUEST', 'DEFAULT_ITEM_USED', 'ROUNDED_UP_TO_UNIT_SCALE']);
    });
  });

  describe('items and defaults', () => {
    it('uses the default item when the line has no item and records DEFAULT_ITEM_USED', () => {
      const line = estimate(2, 0, 0, [{ category: 'WATER' }]).lines[0]!;
      expect(line.item_id).toBe(water.id);
      expect(line.reason_codes).toEqual(['NORM_BY_GROUP', 'DEFAULT_ITEM_USED']);
    });

    it('uses the chosen item instead of the default and does not record DEFAULT_ITEM_USED', () => {
      const line = estimate(2, 0, 0, [{ category: 'WATER', item_id: waterLiter.id }]).lines[0]!;
      expect(line.item_id).toBe(waterLiter.id);
      expect(line.unit_scale).toBe(3);
      expect(line.quantity).toBe('6.000');
      expect(line.reason_codes).toEqual(['NORM_BY_GROUP']);
    });

    it('fails with NEED_ITEM_REQUIRED when neither the line nor the norm names an item', () => {
      const noDefault = norm({ ...waterNorm, default_item_id: null });
      expectCode(() => estimateNeeds({ people: 2, children: 0, elderly: 0, lines: [{ category: 'WATER' }] }, [noDefault], items), 'NEED_ITEM_REQUIRED', 400);
    });

    it('rejects an item that does not exist', () => {
      expectCode(() => estimateNeeds({ people: 2, children: 0, elderly: 0, lines: [{ category: 'WATER', item_id: '00000000-0000-4000-8000-0000000000ff' }] }, norms, items), 'NOT_FOUND', 404);
    });

    it('rejects an inactive item', () => {
      const inactive: NeedEstimateItem = { ...waterLiter, id: 'inactive', status: 'INACTIVE' };
      expectCode(() => estimateNeeds({ people: 2, children: 0, elderly: 0, lines: [{ category: 'WATER', item_id: 'inactive' }] }, norms, [...items, inactive]), 'STATE_TRANSITION_INVALID', 409);
    });

    it('rejects an item from another item type with NEED_ITEM_TYPE_MISMATCH', () => {
      expectCode(() => estimateNeeds({ people: 2, children: 0, elderly: 0, lines: [{ category: 'WATER', item_id: rice.id }] }, norms, items), 'NEED_ITEM_TYPE_MISMATCH', 400);
    });
  });

  describe('categories', () => {
    it('one line per category, in the order given', () => {
      const result = estimate(4, 1, 1, [{ category: 'FOOD' }, { category: 'WATER' }, { category: 'BLANKET' }]);
      expect(result.lines.map((line) => line.category)).toEqual(['FOOD', 'WATER', 'BLANKET']);
    });

    it('skips an unknown category and reports NORM_NOT_FOUND', () => {
      const result = estimate(2, 0, 0, [{ category: 'FUEL' }]);
      expect(result.lines).toEqual([]);
      expect(result.skipped).toEqual([{ category: 'FUEL', reason_codes: ['NORM_NOT_FOUND'] }]);
    });

    it('skips an inactive norm and reports NORM_NOT_FOUND', () => {
      const inactive = norm({ ...foodNorm, active: false });
      const result = estimateNeeds({ people: 2, children: 0, elderly: 0, lines: [{ category: 'FOOD' }] }, [inactive], items);
      expect(result.skipped).toEqual([{ category: 'FOOD', reason_codes: ['NORM_NOT_FOUND'] }]);
    });

    it('omits a zero quantity and reports QUANTITY_ZERO', () => {
      const childOnly = norm({ category: 'CHILD_KIT', item_type_code: 'Y_TE', qty_child: '1.000', default_item_id: kit.id });
      const result = estimateNeeds({ people: 3, children: 0, elderly: 0, lines: [{ category: 'CHILD_KIT' }] }, [childOnly], items);
      expect(result.lines).toEqual([]);
      expect(result.skipped).toEqual([{ category: 'CHILD_KIT', reason_codes: ['QUANTITY_ZERO'] }]);
    });

    it('rejects a duplicate category and an empty line list', () => {
      expectCode(() => estimate(2, 0, 0, [{ category: 'WATER' }, { category: 'WATER' }]), 'VALIDATION_FAILED');
      expectCode(() => estimate(2, 0, 0, []), 'VALIDATION_FAILED');
    });
  });

  describe('large numbers', () => {
    it('handles the maximum people count exactly', () => {
      const line = estimate(NEED_ESTIMATE_MAX_PEOPLE, 0, 0).lines[0]!;
      expect(line.quantity).toBe('30000');
    });

    it('computes per-request and per-N-people at the maximum without loss', () => {
      expect(estimate(NEED_ESTIMATE_MAX_PEOPLE, 0, 0, [{ category: 'BLANKET' }]).lines[0]!.quantity).toBe('5000');
    });

    it('rejects a line whose quantity exceeds the stored maximum', () => {
      const huge = norm({ category: 'HUGE', item_type_code: 'LUONG_THUC', qty_adult: '999999.999', default_item_id: rice.id });
      expectCode(() => estimateNeeds({ people: NEED_ESTIMATE_MAX_PEOPLE, children: 0, elderly: 0, lines: [{ category: 'HUGE' }] }, [huge], items), 'VALIDATION_FAILED');
    });
  });
});

describe('need reason codes', () => {
  it('has Vietnamese copy with diacritics for every code, in one place', () => {
    for (const code of NEED_REASON_CODES) {
      expect(NEED_REASON_COPY[code].trim().length).toBeGreaterThan(0);
      expect(needReasonText(code)).toBe(NEED_REASON_COPY[code]);
      expect(NEED_REASON_COPY[code]).toMatch(/[ăâđêôơưáàảãạéèẻẽẹíìỉĩịóòỏõọúùủũụýỳỷỹỵ]/iu);
    }
  });

  it('no longer carries the retired days or modifier codes', () => {
    const codes: readonly string[] = NEED_REASON_CODES;
    for (const retired of ['NORM_PER_PERSON_DAY', 'NORM_PER_PERSON', 'DAYS_DEFAULT', 'INFANT_MODIFIER_APPLIED', 'ELDERLY_MODIFIER_APPLIED']) {
      expect(codes).not.toContain(retired);
    }
  });
});
