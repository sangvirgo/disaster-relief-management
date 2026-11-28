export type CountLine = {
  outside?: boolean;
  item_id: string;
  counted_quantity: string;
  accepted_quantity: string;
  held_quantity: string;
  rejected_quantity: string;
  condition_note: string;
  expiry_date: string;
};
export type CountDraftScope = { userId: string; deliveryId: string; version: number; mode: string; countRevision?: number; declarationRevision?: number };
export type CountDraft = { lines: CountLine[]; note: string; advanced: boolean; allowUnexpected: boolean; touched: Record<string, boolean>; evidenceName: string };
const prefix = 'c48:count-draft:v1:';
const maxAgeMs = 30 * 60 * 1000;
function key(scope: CountDraftScope) { return prefix + JSON.stringify([scope.userId, scope.deliveryId, scope.mode, scope.version, scope.countRevision ?? null, scope.declarationRevision ?? null]); }

export function readCountDraft(scope: CountDraftScope): CountDraft | null {
  try {
    const raw = sessionStorage.getItem(key(scope));
    if (!raw) return null;
    if (raw.length > 200_000) { clearCountDraft(scope); return null; }
    const value = JSON.parse(raw) as { savedAt: number; draft: CountDraft };
    const draft = value.draft;
    if (!Number.isFinite(value.savedAt) || Date.now() - value.savedAt > maxAgeMs || value.savedAt > Date.now() + 60_000 ||
      !draft || !Array.isArray(draft.lines) || !draft.lines.length || draft.lines.length > 200 ||
      !draft.lines.every(line => line && ['item_id', 'counted_quantity', 'accepted_quantity', 'held_quantity', 'rejected_quantity', 'condition_note', 'expiry_date'].every(field => typeof line[field as keyof CountLine] === 'string') && (line.outside === undefined || typeof line.outside === 'boolean')) ||
      typeof draft.note !== 'string' || typeof draft.evidenceName !== 'string' || typeof draft.advanced !== 'boolean' || typeof draft.allowUnexpected !== 'boolean' ||
      !draft.touched || typeof draft.touched !== 'object' || Array.isArray(draft.touched) || !Object.values(draft.touched).every(value => typeof value === 'boolean')) {
      clearCountDraft(scope); return null;
    }
    return draft;
  } catch { clearCountDraft(scope); return null; }
}

export function writeCountDraft(scope: CountDraftScope, draft: CountDraft): boolean {
  try {
    const value = JSON.stringify({ savedAt: Date.now(), draft });
    if (value.length > 200_000 || !draft.lines.length || draft.lines.length > 200) return false;
    sessionStorage.setItem(key(scope), value); return true;
  }
  catch { return false; }
}
export function clearCountDraft(scope: CountDraftScope) {
  try { sessionStorage.removeItem(key(scope)); } catch { /* Storage may be disabled. */ }
}
export function clearAllCountDrafts() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const value = sessionStorage.key(index);
      if (value?.startsWith(prefix)) sessionStorage.removeItem(value);
    }
  } catch { /* Storage may be disabled. */ }
}
