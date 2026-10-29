import { AppError } from '@c48/technical/errors/errors';
import { quantityUnits, validateQuantity } from '../common/quantity';
import { ReceiptCountLineDto } from './donation-receipts.dto';

export interface ReceiptLineFacts {
  item_id: string;
  counted_quantity: string;
  accepted_quantity: string;
  held_quantity: string;
  rejected_quantity: string;
  declared_quantity: string | null;
  expiry_date: Date | string | null;
  unit_scale: number | string;
  has_count_line: boolean;
}

export function assertUniqueCountItems(lines: readonly ReceiptCountLineDto[]): string[] {
  const itemIds = lines.map((line) => line.item_id);
  if (new Set(itemIds).size !== itemIds.length) throw new AppError('VALIDATION_FAILED', { status: 400 });
  return itemIds;
}

export function validateCountSplit(line: ReceiptCountLineDto, scale: number): void {
  const counted = quantityUnits(validateQuantity(line.counted_quantity, scale, { allowZero: true }), scale);
  const accepted = quantityUnits(validateQuantity(line.accepted_quantity, scale, { allowZero: true }), scale);
  const held = quantityUnits(validateQuantity(line.held_quantity, scale, { allowZero: true }), scale);
  const rejected = quantityUnits(validateQuantity(line.rejected_quantity, scale, { allowZero: true }), scale);
  if (counted !== accepted + held + rejected) throw new AppError('COUNT_SPLIT_MISMATCH', { status: 400 });
}

export function assertHeldReleaseConserved(
  previous: readonly ReceiptLineFacts[],
  current: readonly ReceiptLineFacts[],
): void {
  const byItem = (lines: readonly ReceiptLineFacts[]) => new Map(lines.map((line) => [line.item_id, line]));
  const before = byItem(previous);
  const after = byItem(current);
  const itemIds = new Set([...before.keys(), ...after.keys()]);
  let released = 0n;

  for (const itemId of itemIds) {
    const oldLine = before.get(itemId);
    const newLine = after.get(itemId);
    const scale = Number(newLine?.unit_scale ?? oldLine?.unit_scale ?? 0);
    const oldCounted = units(oldLine?.counted_quantity ?? '0', scale);
    const newCounted = units(newLine?.counted_quantity ?? '0', scale);
    const oldAccepted = units(oldLine?.accepted_quantity ?? '0', scale);
    const newAccepted = units(newLine?.accepted_quantity ?? '0', scale);
    const oldHeld = units(oldLine?.held_quantity ?? '0', scale);
    const newHeld = units(newLine?.held_quantity ?? '0', scale);
    const oldRejected = units(oldLine?.rejected_quantity ?? '0', scale);
    const newRejected = units(newLine?.rejected_quantity ?? '0', scale);
    const acceptedDelta = newAccepted - oldAccepted;
    const heldDelta = oldHeld - newHeld;

    if (newCounted !== oldCounted || newRejected !== oldRejected || acceptedDelta < 0n || heldDelta < 0n || acceptedDelta !== heldDelta) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
    released += acceptedDelta;
  }
  if (released <= 0n) throw new AppError('VALIDATION_FAILED', { status: 400 });
}

export function receiptLineFlags(line: ReceiptLineFacts, now = new Date(), expiringSoonDays = 30): string[] {
  const flags: string[] = [];
  const scale = Number(line.unit_scale);
  const values = [line.counted_quantity, line.accepted_quantity, line.held_quantity, line.rejected_quantity];
  const unitError = !Number.isInteger(scale) || scale < 0 || scale > 3 || values.some((value) => fractionDigits(value) > scale) ||
    (line.declared_quantity !== null && fractionDigits(line.declared_quantity) > scale);

  if (line.has_count_line && line.declared_quantity === null) flags.push('UNEXPECTED_ITEM');
  if ((line.has_count_line || line.declared_quantity !== null) && unitError) flags.push('UNIT_OR_SCALE_ERROR');
  if (line.declared_quantity !== null && !unitError) {
    const counted = units(line.counted_quantity, scale);
    const declared = units(line.declared_quantity, scale);
    flags.push(counted === declared ? 'MATCH' : counted < declared ? 'SHORT' : 'OVER');
  }
  if (line.has_count_line) {
    if (line.expiry_date && new Date(line.expiry_date).getTime() <= now.getTime() + expiringSoonDays * 86_400_000) {
      flags.push('EXPIRING_SOON');
    }
  }
  return flags;
}

function units(value: string, scale: number): bigint {
  return receiptQuantityUnits(value, scale);
}

export function receiptQuantityUnits(value: string, scale: number): bigint {
  return quantityUnits(validateQuantity(normalizeQuantity(value), scale, { allowZero: true }), scale);
}

function fractionDigits(value: string): number {
  return normalizeQuantity(value).split('.')[1]?.length ?? 0;
}

function normalizeQuantity(value: string): string {
  const match = /^(-?(?:0|[1-9][0-9]*))(?:\.([0-9]+))?$/u.exec(value);
  if (!match || match[2] === undefined) return value;
  const fraction = match[2].replace(/0+$/u, '');
  return fraction ? `${match[1]}.${fraction}` : match[1]!;
}
