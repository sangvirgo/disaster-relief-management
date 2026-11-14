import { hasPermission } from '@c48/identity-contracts/permissions';
import type { Grant } from '@c48/identity-contracts/permissions';

/** A claim is held only while its holder keeps working on the request; each coordination action refreshes it. */
export const CLAIM_TTL_MINUTES = 15;

const CLAIM_TTL_MS = CLAIM_TTL_MINUTES * 60_000;

export function claimIsActive(handledAt: Date | string | null, now: Date): boolean {
  if (!handledAt) return false;
  return now.getTime() - new Date(handledAt).getTime() < CLAIM_TTL_MS;
}

export function claimConflictMessage(holderName: string | null): string {
  return `Hồ sơ đang do ${holderName ?? 'người khác'} xử lý.`;
}

/** Coordinators act on a request through their campaign grant, or through a SYSTEM grant for unattached requests. */
export function canCoordinateRequest(grants: readonly Grant[], campaignId: string | null): boolean {
  return hasPermission(grants, 'REQUEST_VERIFY', { campaignId });
}

/** SYSTEM coordinators may take over or release another coordinator's claim (recorded in request_event). */
export function isSystemCoordinator(grants: readonly Grant[]): boolean {
  return hasPermission(grants, 'REQUEST_VERIFY', { campaignId: null });
}
