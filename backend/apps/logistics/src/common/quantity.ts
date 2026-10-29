import { AppError } from '@c48/technical/errors/errors';

const decimalPattern = /^(-?(?:0|[1-9][0-9]*))(?:\.([0-9]+))?$/u;

function trimTrailingFractionZeros(value: string): string {
  const match = decimalPattern.exec(value);
  if (!match?.[2]) return value;
  const fraction = match[2].replace(/0+$/u, '');
  return fraction ? `${match[1]}.${fraction}` : match[1]!;
}

export function validateQuantity(
  value: string,
  scale: number,
  options: { allowNegative?: boolean; allowZero?: boolean } = {},
): string {
  if (!Number.isInteger(scale) || scale < 0 || scale > 3 || !decimalPattern.test(value)) {
    throw new AppError('VALIDATION_FAILED', { status: 400 });
  }
  const unsigned = value.startsWith('-') ? value.slice(1) : value;
  const [integer, fraction = ''] = unsigned.split('.');
  if (fraction.length > scale) throw new AppError('QUANTITY_SCALE_INVALID', { status: 400 });
  if (integer!.replace(/^0+/u, '').length > 15) throw new AppError('VALIDATION_FAILED', { status: 400 });
  if (value.startsWith('-') && !options.allowNegative) throw new AppError('VALIDATION_FAILED', { status: 400 });
  if (!options.allowZero && !/[1-9]/u.test(unsigned)) throw new AppError('VALIDATION_FAILED', { status: 400 });
  return value;
}

export function quantityUnits(value: string, scale: number): bigint {
  const normalized = trimTrailingFractionZeros(value);
  validateQuantity(normalized, scale, { allowNegative: true, allowZero: true });
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [integer, fraction = ''] = unsigned.split('.');
  const units = BigInt(`${integer}${fraction.padEnd(scale, '0')}`);
  return negative ? -units : units;
}

export function decimalFromUnits(units: bigint, scale: number): string {
  if (scale === 0) return units.toString();
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  const divisor = 10n ** BigInt(scale);
  const integer = absolute / divisor;
  const fraction = (absolute % divisor).toString().padStart(scale, '0');
  return `${negative ? '-' : ''}${integer}.${fraction}`;
}
