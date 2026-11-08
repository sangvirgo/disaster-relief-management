/** Format API decimal strings for Vietnamese readers without changing their value. */
export function formatQuantity(value: unknown): string {
  if (value == null) return '—';
  const raw = String(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) return raw;

  const negative = raw.startsWith('-');
  const [whole, fraction = ''] = (negative ? raw.slice(1) : raw).split('.');
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
  const groupedWhole = normalizedWhole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const meaningfulFraction = fraction.replace(/0+$/, '');
  const formatted = meaningfulFraction ? `${groupedWhole},${meaningfulFraction}` : groupedWhole;
  return negative && formatted !== '0' ? `-${formatted}` : formatted;
}

export function quantityFitsScale(value: string, scale: number): boolean {
  return /^\d+(?:\.\d+)?$/.test(value) && Number.isInteger(scale) && scale >= 0 &&
    (value.split('.')[1]?.replace(/0+$/, '').length || 0) <= scale;
}

/** Exact nonnegative remainder for decimal API strings, without rounding to a unit. */
export function remainingQuantity(target: string, received: string): string | null {
  if (![target, received].every(value => /^\d+(?:\.\d+)?$/.test(value))) return null;
  const parts = [target, received].map(value => value.split('.'));
  const scale = Math.max(...parts.map(([, fraction = '']) => fraction.length));
  const integers = parts.map(([whole, fraction = '']) => BigInt(whole + fraction.padEnd(scale, '0')));
  const difference = integers[0] - integers[1];
  if (difference <= 0n) return '0';
  const digits = difference.toString().padStart(scale + 1, '0');
  return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
}
