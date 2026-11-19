import { AppError } from '@c48/technical/errors/errors';
import { decimalFromUnits } from '../common/quantity';
import type { NeedReasonCode } from './need-reasons';

// Pure estimate rule (no AI, no I/O). One estimate line per category, computed from the SOS facts and one norm:
//   BY_GROUP      quantity = adults*qty_adult + children*qty_child + elderly*qty_elderly
//                 where adults = people - children - elderly
//   PER_N_PEOPLE  quantity = ceil(people / people_per_unit)
//   PER_REQUEST   quantity = fixed_quantity
// The result is rounded UP to the item's unit scale. All arithmetic uses BigInt units (norms have 3 decimals), so there is
// no floating-point drift. The quantity is never decided by AI and never by a human typing counts into the estimate.

export const NEED_ESTIMATE_MAX_PEOPLE = 10_000;
export const NEED_ESTIMATE_MAX_CATEGORIES = 16;
/** Upper bound for one estimated line, in whole item units. Keeps the stored quantity inside numeric(18,3). */
export const NEED_ESTIMATE_MAX_QUANTITY = 1_000_000_000n;

const NORM_SCALE = 3;
const CATEGORY_PATTERN = /^[A-Z0-9_]{2,40}$/u;
const decimalPattern = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/u;

export type NeedQuantityBasis = 'BY_GROUP' | 'PER_N_PEOPLE' | 'PER_REQUEST';

export interface NeedEstimateNorm {
  id: string;
  category: string;
  item_type_code: string;
  quantity_basis: NeedQuantityBasis;
  qty_adult: string;
  qty_child: string;
  qty_elderly: string;
  people_per_unit: number | null;
  fixed_quantity: string | null;
  default_item_id: string | null;
  active: boolean;
  version: number;
}

/** Catalog snapshot for the items named by the lines or by a norm's default item. */
export interface NeedEstimateItem {
  id: string;
  item_type_code: string;
  unit_scale: number;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface NeedEstimateLineInput {
  category: string;
  item_id?: string | null;
}

export interface NeedEstimateInput {
  people: number;
  children: number;
  elderly: number;
  lines: readonly NeedEstimateLineInput[];
}

export interface NeedEstimateBasisInputs {
  people: number;
  children: number;
  elderly: number;
  adults: number;
  qty_adult: string;
  qty_child: string;
  qty_elderly: string;
  people_per_unit: number | null;
  fixed_quantity: string | null;
  raw_quantity: string;
}

export interface NeedEstimateLine {
  category: string;
  item_id: string;
  item_type_code: string;
  norm_id: string;
  norm_version: number;
  unit_scale: number;
  quantity: string;
  estimate_basis: { basis: NeedQuantityBasis; inputs: NeedEstimateBasisInputs };
  reason_codes: NeedReasonCode[];
}

export interface NeedEstimateSkipped {
  category: string;
  reason_codes: NeedReasonCode[];
}

export interface NeedEstimateResult {
  lines: NeedEstimateLine[];
  skipped: NeedEstimateSkipped[];
}

function invalid(): never {
  throw new AppError('VALIDATION_FAILED', { status: 400 });
}

function isCount(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Parses a non-negative decimal string into integer units of 10^-decimals. */
export function decimalUnits(value: string, decimals: number): bigint {
  if (!decimalPattern.test(value)) invalid();
  const [integer, fraction = ''] = value.split('.');
  if (fraction.length > decimals) invalid();
  return BigInt(`${integer}${fraction.padEnd(decimals, '0')}`);
}

/** People counts only: adults are derived, so the groups can never exceed the total. */
export function validateEstimatePeople(people: number, children: number, elderly: number): { adults: number } {
  if (!isCount(people, 1, NEED_ESTIMATE_MAX_PEOPLE)) invalid();
  if (!isCount(children, 0, NEED_ESTIMATE_MAX_PEOPLE) || !isCount(elderly, 0, NEED_ESTIMATE_MAX_PEOPLE)) invalid();
  if (children + elderly > people) invalid();
  return { adults: people - children - elderly };
}

function requestedQuantity(
  norm: NeedEstimateNorm,
  people: number,
  adults: number,
  children: number,
  elderly: number,
): { raw3: bigint; reasons: NeedReasonCode[] } {
  switch (norm.quantity_basis) {
    case 'BY_GROUP': {
      const raw3 = BigInt(adults) * decimalUnits(norm.qty_adult, NORM_SCALE)
        + BigInt(children) * decimalUnits(norm.qty_child, NORM_SCALE)
        + BigInt(elderly) * decimalUnits(norm.qty_elderly, NORM_SCALE);
      return { raw3, reasons: ['NORM_BY_GROUP'] };
    }
    case 'PER_N_PEOPLE': {
      if (!isCount(norm.people_per_unit, 1, NEED_ESTIMATE_MAX_PEOPLE)) invalid();
      const units = BigInt(Math.ceil(people / norm.people_per_unit));
      return { raw3: units * 10n ** BigInt(NORM_SCALE), reasons: ['NORM_PER_N_PEOPLE'] };
    }
    case 'PER_REQUEST': {
      if (norm.fixed_quantity === null) invalid();
      return { raw3: decimalUnits(norm.fixed_quantity, NORM_SCALE), reasons: ['NORM_PER_REQUEST'] };
    }
    default:
      return invalid();
  }
}

export function estimateNeeds(
  input: NeedEstimateInput,
  norms: readonly NeedEstimateNorm[],
  items: readonly NeedEstimateItem[],
): NeedEstimateResult {
  const { adults } = validateEstimatePeople(input.people, input.children, input.elderly);
  if (!Array.isArray(input.lines) || input.lines.length === 0 || input.lines.length > NEED_ESTIMATE_MAX_CATEGORIES) invalid();

  const seen = new Set<string>();
  const result: NeedEstimateResult = { lines: [], skipped: [] };

  for (const line of input.lines) {
    if (typeof line.category !== 'string' || !CATEGORY_PATTERN.test(line.category)) invalid();
    if (seen.has(line.category)) invalid();
    seen.add(line.category);

    const norm = norms.find((candidate) => candidate.active && candidate.category === line.category);
    if (!norm) {
      result.skipped.push({ category: line.category, reason_codes: ['NORM_NOT_FOUND'] });
      continue;
    }

    const usedDefault = !line.item_id;
    const itemId = line.item_id ?? norm.default_item_id;
    if (!itemId) throw new AppError('NEED_ITEM_REQUIRED', { status: 400 });
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) throw new AppError('NOT_FOUND', { status: 404 });
    if (item.status !== 'ACTIVE') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
    if (item.item_type_code !== norm.item_type_code) throw new AppError('NEED_ITEM_TYPE_MISMATCH', { status: 400 });
    if (!isCount(item.unit_scale, 0, NORM_SCALE)) invalid();

    const { raw3, reasons } = requestedQuantity(norm, input.people, adults, input.children, input.elderly);
    // raw3 is in 10^-3 units; the item's quantity is in 10^-scale units, so round the division up.
    const step = 10n ** BigInt(NORM_SCALE - item.unit_scale);
    const quantityUnits = (raw3 + step - 1n) / step;
    if (quantityUnits === 0n) {
      result.skipped.push({ category: line.category, reason_codes: ['QUANTITY_ZERO'] });
      continue;
    }
    if (quantityUnits > NEED_ESTIMATE_MAX_QUANTITY * 10n ** BigInt(item.unit_scale)) invalid();

    const reasonCodes: NeedReasonCode[] = [...reasons];
    if (usedDefault) reasonCodes.push('DEFAULT_ITEM_USED');
    if (raw3 % step !== 0n) reasonCodes.push('ROUNDED_UP_TO_UNIT_SCALE');

    result.lines.push({
      category: norm.category,
      item_id: item.id,
      item_type_code: item.item_type_code,
      norm_id: norm.id,
      norm_version: norm.version,
      unit_scale: item.unit_scale,
      quantity: decimalFromUnits(quantityUnits, item.unit_scale),
      estimate_basis: {
        basis: norm.quantity_basis,
        inputs: {
          people: input.people,
          children: input.children,
          elderly: input.elderly,
          adults,
          qty_adult: norm.qty_adult,
          qty_child: norm.qty_child,
          qty_elderly: norm.qty_elderly,
          people_per_unit: norm.people_per_unit,
          fixed_quantity: norm.fixed_quantity,
          raw_quantity: decimalFromUnits(raw3, NORM_SCALE),
        },
      },
      reason_codes: reasonCodes,
    });
  }
  return result;
}
