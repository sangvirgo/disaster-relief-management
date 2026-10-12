import { AppError } from '../../../../packages/technical/src/errors/errors';

const decimalPattern = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

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
  validateQuantity(value, scale, { allowNegative: true, allowZero: true });
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [integer, fraction = ''] = unsigned.split('.');
  const units = BigInt(`${integer}${fraction.padEnd(scale, '0')}`);
  return negative ? -units : units;
}
