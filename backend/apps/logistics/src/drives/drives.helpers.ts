import { randomBytes } from 'node:crypto';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { Grant, hasPermission, Permission } from '../../../../packages/identity-contracts/src/permissions';
import type { AuthenticatedLogisticsSession } from '../auth/logistics-session.service';

export interface DriveScope {
  organization_id: string;
  region_code: string;
}

export function requireDrivePermission(
  session: AuthenticatedLogisticsSession,
  permission: Permission,
  scope: DriveScope,
): void {
  if (!hasPermission(session.grants, permission, {
    organizationId: scope.organization_id,
    regionCode: scope.region_code,
  })) throw new AppError('FORBIDDEN', { status: 403 });
}

export function driveScopeSql(
  grants: readonly Grant[],
  values: unknown[],
  permissions: readonly Permission[],
  alias = 'd',
): string {
  const branches = new Set<string>();
  for (const grant of grants) {
    const organizationId = grant.organization_id;
    if (!organizationId) continue;
    const permission = permissions.find((candidate) => grant.scope_type === 'ORGANIZATION'
      ? hasPermission([grant], candidate, { organizationId, regionCode: '__scope_check__' })
      : grant.scope_type === 'REGION' && grant.region_code
        ? hasPermission([grant], candidate, { organizationId, regionCode: grant.region_code })
        : false);
    if (!permission) continue;
    if (grant.scope_type === 'ORGANIZATION' && !grant.region_code && !grant.campaign_id) {
      values.push(organizationId);
      branches.add(`${alias}.organization_id=$${values.length}`);
    } else if (grant.scope_type === 'REGION' && grant.region_code && !grant.campaign_id) {
      values.push(organizationId, grant.region_code);
      branches.add(`(${alias}.organization_id=$${values.length - 1} AND ${alias}.region_code=$${values.length})`);
    }
  }
  if (branches.size === 0) throw new AppError('FORBIDDEN', { status: 403 });
  return `(${[...branches].join(' OR ')})`;
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
