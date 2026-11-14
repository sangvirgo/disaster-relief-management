import { randomBytes } from 'node:crypto';
import { AppError } from '@c48/technical/errors/errors';
import { Grant, hasPermission, Permission } from '@c48/identity-contracts/permissions';
import type { AuthenticatedLogisticsSession } from '../auth/logistics-session.service';

export interface DriveScope {
  campaign_id: string | null;
}

export function requireDrivePermission(
  session: AuthenticatedLogisticsSession,
  permission: Permission,
  scope: DriveScope,
): void {
  if (!hasPermission(session.grants, permission, { campaignId: scope.campaign_id })) {
    throw new AppError('FORBIDDEN', { status: 403 });
  }
}

/**
 * List predicate for drives. A SYSTEM grant sees every drive; CAMPAIGN grants see only drives
 * attached to their campaigns. Unattached drives are reachable through SYSTEM grants only.
 */
export function driveScopeSql(
  grants: readonly Grant[],
  values: unknown[],
  permissions: readonly Permission[],
  alias = 'd',
): string {
  const allowed = grants.filter((grant) => permissions.some((permission) => hasPermission([grant], permission, { campaignId: grant.campaign_id ?? null })));
  if (allowed.length === 0) throw new AppError('FORBIDDEN', { status: 403 });
  if (allowed.some((grant) => grant.scope_type === 'SYSTEM')) return 'TRUE';
  const campaigns = [...new Set(allowed.map((grant) => grant.campaign_id).filter((id): id is string => Boolean(id)))];
  if (campaigns.length === 1) {
    values.push(campaigns[0]);
    return `(${alias}.campaign_id=$${values.length})`;
  }
  values.push(campaigns);
  return `(${alias}.campaign_id=ANY($${values.length}::uuid[]))`;
}

export function assertExpectedVersion(actual: number | string, expected: number): void {
  if (Number(actual) !== expected) {
    throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(actual) } });
  }
}

export function cleanDriveText(value: string | null | undefined, required = false): string | null {
  if (value === undefined || value === null) return null;
  const normalized = value.trim();
  if ((required && !normalized) || normalized !== value.normalize('NFC')) {
    throw new AppError('VALIDATION_FAILED', { status: 400 });
  }
  return normalized || null;
}

export function assertDriveWindow(opensAt: Date | string | null, closesAt: Date | string | null, now = Date.now()): void {
  if ((opensAt && new Date(opensAt).getTime() > now) || (closesAt && new Date(closesAt).getTime() <= now)) {
    throw new AppError('DRIVE_WINDOW_CLOSED', { status: 409 });
  }
}

export function generatePublicCode(): string {
  const bytes = randomBytes(10);
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let buffer = 0;
  let bits = 0;
  let result = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(buffer >> bits) & 31];
    }
  }
  return result;
}
