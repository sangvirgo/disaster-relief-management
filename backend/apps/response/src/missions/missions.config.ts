export const MISSIONS_CONFIG = Symbol('MISSIONS_CONFIG');

export interface MissionsConfig {
  offerOverdueMinutes: number;
}

export function loadMissionsConfig(env: Record<string, string | undefined> = process.env): MissionsConfig {
  const offerOverdueMinutes = Number(env.OFFER_OVERDUE_MINUTES ?? 10);
  if (!Number.isSafeInteger(offerOverdueMinutes) || offerOverdueMinutes < 1 || offerOverdueMinutes > 1_440) {
    throw new Error('Invalid Response configuration: OFFER_OVERDUE_MINUTES');
  }
  return { offerOverdueMinutes };
}
