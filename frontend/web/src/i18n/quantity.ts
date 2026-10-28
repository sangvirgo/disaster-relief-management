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
