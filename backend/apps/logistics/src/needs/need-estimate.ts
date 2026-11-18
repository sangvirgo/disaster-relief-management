import { AppError } from '@c48/technical/errors/errors';
import { decimalFromUnits } from '../common/quantity';
import type { NeedReasonCode } from './need-reasons';

// Pure estimate rule (no AI, no I/O):
//   effective_persons = people_count + infants * modifier_infant + elderly * modifier_elderly
//   raw               = qty_per_person_per_day * days * effective_persons   (PER_PERSON basis: days factor is 1)
//   quantity          = raw rounded UP to the item's unit scale
// People counts include infants and elderly; each modifier is the extra share of one norm added per person in that group.
// All arithmetic uses BigInt units to avoid floating-point drift: norm quantities have 3 decimals, modifiers 2, raw 5.

export const NEED_ESTIMATE_DEFAULT_DAYS = 3;
export const NEED_ESTIMATE_MAX_DAYS = 30;
export const NEED_ESTIMATE_MAX_PEOPLE = 10_000;

export type NeedQuantityBasis = 'PER_PERSON_DAY' | 'PER_PERSON';

export interface NeedEstimateNorm {
  id: string;
  category: string;
  item_type_code: string;
  quantity_basis: NeedQuantityBasis;
  qty_per_person_per_day: string;
  modifier_infant: string;
  modifier_elderly: string;
  active: boolean;
  version: number;
}

export interface NeedEstimateCategory {
  category: string;
  item_type_code: string;
  unit_scale: number;
}

export interface NeedEstimateInput {
  people_count: number;
  days?: number;
  infants?: number;
  elderly?: number;
  categories: readonly NeedEstimateCategory[];
}

export interface NeedEstimateLine {
  category: string;
  item_type_code: string;
  norm_id: string;
  norm_version: number;
  unit_scale: number;
  quantity: string;
  raw_quantity: string;
  days: number;
  effective_persons: string;
  reason_codes: NeedReasonCode[];
}

export interface NeedEstimateSkipped {
  category: string;
  item_type_code: string;
  reason_codes: NeedReasonCode[];
}

export interface NeedEstimateResult {
  lines: NeedEstimateLine[];
  skipped: NeedEstimateSkipped[];
}

const RAW_SCALE = 5;
const NORM_SCALE = 3;
const MODIFIER_SCALE = 2;
const PERSON_SCALE = 2;
const decimalPattern = /^(0|[1-9][0-9]*)(\.[0-9]+)?$/u;

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

function validateInput(input: NeedEstimateInput): { people: number; days: number; infants: number; elderly: number } {
  const people = input.people_count;
  const days = input.days ?? NEED_ESTIMATE_DEFAULT_DAYS;
  const infants = input.infants ?? 0;
  const elderly = input.elderly ?? 0;
  if (!isCount(people, 1, NEED_ESTIMATE_MAX_PEOPLE)) invalid();
  if (!isCount(days, 1, NEED_ESTIMATE_MAX_DAYS)) invalid();
  if (!isCount(infants, 0, NEED_ESTIMATE_MAX_PEOPLE) || !isCount(elderly, 0, NEED_ESTIMATE_MAX_PEOPLE)) invalid();
  if (infants + elderly > people) invalid();
  return { people, days, infants, elderly };
}

export function estimateNeeds(input: NeedEstimateInput, norms: readonly NeedEstimateNorm[]): NeedEstimateResult {
  const { people, days, infants, elderly } = validateInput(input);
  const daysDefaulted = input.days === undefined;
  const seen = new Set<string>();
  const result: NeedEstimateResult = { lines: [], skipped: [] };

  for (const category of input.categories) {
    if (!isCount(category.unit_scale, 0, 3)) invalid();
    const key = `${category.category}|${category.item_type_code}`;
    if (seen.has(key)) invalid();
    seen.add(key);

    const norm = norms.find((candidate) =>
      candidate.active && candidate.category === category.category && candidate.item_type_code === category.item_type_code);
    if (!norm) {
      result.skipped.push({ category: category.category, item_type_code: category.item_type_code, reason_codes: ['NORM_NOT_FOUND'] });
      continue;
    }

    const perPersonDay = norm.quantity_basis === 'PER_PERSON_DAY';
    const normUnits = decimalUnits(norm.qty_per_person_per_day, NORM_SCALE);
    const infantModifier = decimalUnits(norm.modifier_infant, MODIFIER_SCALE);
    const elderlyModifier = decimalUnits(norm.modifier_elderly, MODIFIER_SCALE);
    if (normUnits <= 0n) invalid();

    // effective persons in 10^-2 units
    const personUnits = BigInt(people) * 100n + BigInt(infants) * infantModifier + BigInt(elderly) * elderlyModifier;
    const daysFactor = perPersonDay ? BigInt(days) : 1n;
    // norm (10^-3) * persons (10^-2) * days => raw in 10^-5 units
    const rawUnits = normUnits * personUnits * daysFactor;
    const step = 10n ** BigInt(RAW_SCALE - category.unit_scale);
    const quantityUnits = (rawUnits + step - 1n) / step;
    const reasons: NeedReasonCode[] = [perPersonDay ? 'NORM_PER_PERSON_DAY' : 'NORM_PER_PERSON'];
    if (perPersonDay && daysDefaulted) reasons.push('DAYS_DEFAULT');
    if (infants > 0 && infantModifier > 0n) reasons.push('INFANT_MODIFIER_APPLIED');
    if (elderly > 0 && elderlyModifier > 0n) reasons.push('ELDERLY_MODIFIER_APPLIED');
    if (rawUnits % step !== 0n) reasons.push('ROUNDED_UP_TO_UNIT_SCALE');

    result.lines.push({
      category: category.category,
      item_type_code: category.item_type_code,
      norm_id: norm.id,
      norm_version: norm.version,
      unit_scale: category.unit_scale,
      quantity: decimalFromUnits(quantityUnits, category.unit_scale),
      raw_quantity: decimalFromUnits(rawUnits, RAW_SCALE),
      days: perPersonDay ? days : 1,
      effective_persons: decimalFromUnits(personUnits, PERSON_SCALE),
      reason_codes: reasons,
    });
  }
  return result;
}
