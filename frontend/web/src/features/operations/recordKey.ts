// Logistics read models have different identities; aggregate reports have no row UUID.
export function operationRecordKey(row: Record<string, unknown>): string {
  if (typeof row.id === 'string' && row.id) return `id:${row.id}`;
  if (typeof row.balance_id === 'string' && row.balance_id) return `balance:${row.balance_id}`;
  const item = row.item as { id?: unknown } | undefined;
  const itemId = typeof row.item_id === 'string' ? row.item_id : item?.id;
  if (typeof itemId === 'string' && itemId) {
    return `item:${typeof row.warehouse_id === 'string' ? row.warehouse_id : ''}:${itemId}`;
  }
  return JSON.stringify(row);
}
