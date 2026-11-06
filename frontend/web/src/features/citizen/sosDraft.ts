export type SosDraft = {
  mode: 'SELF' | 'PROXY';
  category: string;
  description: string;
  people: string;
  children: string;
  elderly: string;
  name: string;
  phone: string;
  beneficiaryPhone: string;
  alternateName: string;
  alternatePhone: string;
  danger: boolean;
  needsRescue: boolean;
  needsRelief: boolean;
  longitude: string;
  latitude: string;
  relationship: string;
  informationSource: string;
  situationAt: string;
  contactability: string;
};

const prefix = 'c48:sos-draft:v1:';
const maxAgeMs = 30 * 60 * 1000;

function key(userId?: string | null) {
  return `${prefix}${userId || 'guest'}`;
}

export function readSosDraft(userId?: string | null): SosDraft | null {
  try {
    const stored = sessionStorage.getItem(key(userId));
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid SOS draft');
    const envelope = parsed as { savedAt?: unknown; draft?: unknown };
    if (typeof envelope.savedAt !== 'number' || Date.now() - envelope.savedAt > maxAgeMs ||
      !envelope.draft || typeof envelope.draft !== 'object') throw new Error('Expired SOS draft');
    const draft = envelope.draft as SosDraft;
    const textFields: Array<keyof SosDraft> = [
      'category', 'description', 'people', 'children', 'elderly', 'name', 'phone',
      'beneficiaryPhone', 'alternateName', 'alternatePhone', 'longitude', 'latitude',
      'relationship', 'informationSource', 'situationAt', 'contactability',
    ];
    if (!textFields.every((field) => typeof draft[field] === 'string') ||
      !['SELF', 'PROXY'].includes(draft.mode) ||
      !['UNKNOWN', 'REACHABLE', 'UNREACHABLE'].includes(draft.contactability) ||
      !['danger', 'needsRescue', 'needsRelief'].every((field) => typeof draft[field as keyof SosDraft] === 'boolean')) {
      throw new Error('Invalid SOS draft');
    }
    return draft;
  } catch {
    clearSosDraft(userId);
    return null;
  }
}

export function writeSosDraft(userId: string | null | undefined, draft: SosDraft): void {
  try {
    sessionStorage.setItem(key(userId), JSON.stringify({ savedAt: Date.now(), draft }));
  } catch {
    // The form remains usable if storage is unavailable.
  }
}

export function clearSosDraft(userId?: string | null): void {
  try { sessionStorage.removeItem(key(userId)); } catch { /* Storage can be disabled. */ }
}

export function clearAllSosDrafts(): void {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const storageKey = sessionStorage.key(index);
      if (storageKey?.startsWith(prefix)) sessionStorage.removeItem(storageKey);
    }
  } catch { /* Storage can be disabled. */ }
}
