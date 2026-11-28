export type MissionDraft = {
  status: string;
  action: 'complete' | 'fail' | 'decline';
  outcome: string;
  progress: string;
  decline: string;
};
const prefix = 'c48:mission-draft:v1:';
const maxAge = 30 * 60_000;
const key = (user: string, mission: string) => prefix + JSON.stringify([user, mission]);

export function readMissionDraft(user: string, mission: string, status: string): MissionDraft | null {
  try {
    const raw = sessionStorage.getItem(key(user, mission));
    if (!raw) return null;
    if (raw.length > 16_000) throw new Error('Oversized draft');
    const { savedAt, draft } = JSON.parse(raw) as { savedAt: number; draft: MissionDraft };
    if (!Number.isFinite(savedAt) || savedAt > Date.now() + 60_000 || Date.now() - savedAt > maxAge ||
      !draft || draft.status !== status || !['complete', 'fail', 'decline'].includes(draft.action) ||
      ![draft.outcome, draft.progress, draft.decline].every(value => typeof value === 'string' && value.length <= 2001)) {
      throw new Error('Stale or invalid draft');
    }
    return draft;
  } catch { clearMissionDraft(user, mission); return null; }
}
export function writeMissionDraft(user: string, mission: string, draft: MissionDraft): boolean {
  try {
    if (![draft.outcome, draft.progress, draft.decline].some(value => value.trim())) {
      clearMissionDraft(user, mission); return true;
    }
    sessionStorage.setItem(key(user, mission), JSON.stringify({ savedAt: Date.now(), draft }));
    return true;
  } catch { return false; }
}
export function clearMissionDraft(user: string, mission: string) {
  try { sessionStorage.removeItem(key(user, mission)); } catch { /* Storage can be disabled. */ }
}
export function clearAllMissionDrafts() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const name = sessionStorage.key(index);
      if (name?.startsWith(prefix)) sessionStorage.removeItem(name);
    }
  } catch { /* Logout still completes. */ }
}
