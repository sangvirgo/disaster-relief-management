import { quantityFitsScale } from '../../i18n/quantity.ts';

export function validSupplyQuantity(value: string, scale: number): boolean {
  return quantityFitsScale(value.trim(), scale) && Number.isFinite(Number(value)) && Number(value) > 0;
}

/** A visible line is either included or blocks the whole command; never submit a filtered partial request. */
export function prepareSupplyLines<T extends { item_id: string; quantity: string }>(lines: T[], scaleOf: (id: string) => number): { lines: T[] | null; invalidItemIds: string[] } {
  const normalized = lines.map(line => ({ ...line, quantity: line.quantity.trim() }));
  const invalidItemIds = normalized.filter(line => !validSupplyQuantity(line.quantity, scaleOf(line.item_id))).map(line => line.item_id);
  return { lines: normalized.length && !invalidItemIds.length ? normalized : null, invalidItemIds };
}
