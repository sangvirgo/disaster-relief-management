/** Check exact structured counts. Semantic interpretation remains advisory and human-reviewed. */
export function advisoryCountsMatchInput(value: Record<string, unknown>, text: string): boolean {
  let input: unknown;
  try { input = JSON.parse(text); } catch { return false; }
  if (!input || typeof input !== 'object') return false;
  const envelope = input as Record<string, unknown>;
  const source = (Object.hasOwn(envelope, 'sos') ? envelope.sos : envelope) as Record<string, unknown>;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  const facts = value.facts as Record<string, unknown>;
  if (!facts || typeof facts !== 'object') return false;
  const fields = ['people_affected', 'children_count', 'elderly_count'] as const;
  for (const field of fields) {
    // Omitted facts stay unknown. Do not manufacture a zero or silently correct model output.
    if (Number.isInteger(source[field]) && facts[field] !== undefined && facts[field] !== source[field]) return false;
  }
  const total = source.people_affected ?? facts.people_affected;
  const children = source.children_count ?? facts.children_count;
  const elderly = source.elderly_count ?? facts.elderly_count;
  if (Number.isInteger(total)) {
    if (Number.isInteger(children) && Number(children) > Number(total)) return false;
    if (Number.isInteger(elderly) && Number(elderly) > Number(total)) return false;
    if (Number.isInteger(children) && Number.isInteger(elderly) && Number(children) + Number(elderly) > Number(total)) return false;
  }
  return true;
}
