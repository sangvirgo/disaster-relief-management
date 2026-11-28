export type SupplySessionLine = { item_id: string; quantity: string };
const prefix = 'c48:supply-draft:v1:';
const key = (user: string, mission: string) => prefix + JSON.stringify([user, mission]);
export function readSupplyDraft(user: string, mission: string): SupplySessionLine[] | null {
  if (!user) return null;
  try {
    const raw = sessionStorage.getItem(key(user, mission));
    if (!raw) return null;
    if (raw.length > 32_000) throw new Error('Oversized draft');
    const value = JSON.parse(raw);
    if (!Number.isFinite(value.savedAt) || value.savedAt > Date.now() + 60_000 || Date.now() - value.savedAt > 30 * 60_000 ||
      !Array.isArray(value.lines) || value.lines.length > 100 ||
      !value.lines.every((line: SupplySessionLine) => line && typeof line.item_id === 'string' && line.item_id.length <= 100 && typeof line.quantity === 'string' && line.quantity.length <= 100) ||
      new Set(value.lines.map((line: SupplySessionLine) => line.item_id)).size !== value.lines.length) throw new Error('Invalid draft');
    return value.lines;
  } catch { clearSupplyDraft(user, mission); return null; }
}
export function writeSupplyDraft(user: string, mission: string, lines: SupplySessionLine[]): boolean {
  if (!user) return false;
  try {
    const value = JSON.stringify({ savedAt: Date.now(), lines: lines.map(({ item_id, quantity }) => ({ item_id, quantity })) });
    if (value.length > 32_000 || lines.length > 100 || lines.some(line => line.quantity.length > 100)) return false;
    sessionStorage.setItem(key(user, mission), value);
    return true;
  } catch { return false; }
}
export function clearSupplyDraft(user: string, mission: string) {
  try { sessionStorage.removeItem(key(user, mission)); } catch { /* Storage may be disabled. */ }
}
export function clearAllSupplyDrafts() {
  try {
    for (let at = sessionStorage.length - 1; at >= 0; at--) {
      const name = sessionStorage.key(at);
      if (name?.startsWith(prefix)) sessionStorage.removeItem(name);
    }
  } catch { /* Logout still completes. */ }
}
