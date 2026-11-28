/** Package labels for legacy piece-counted demo items during migration rollout.
 * Counts stay unchanged; explicit units (litres, kg, cartons) remain authoritative. */
const packageUnits: Record<string, string> = {
  '00000000-0000-4000-8000-0000000a1002': 'gói',
  '00000000-0000-4000-8000-0000000a1003': 'chai',
  '00000000-0000-4000-8000-0000000a1011': 'chai',
};
export function itemUnitName(itemId: unknown, unit: unknown): string {
  const name = typeof unit === 'string' ? unit : '';
  return (name === 'cái' || name === 'CAI') && typeof itemId === 'string' ? packageUnits[itemId] ?? name : name;
}
