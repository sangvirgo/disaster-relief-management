import { AppError } from '@c48/technical/errors/errors';
import { Permission, ROLE_PERMISSIONS, Grant } from '@c48/identity-contracts/permissions';
import type { ReporterSession } from './reporter-session';

/** The fields used to decide whether a request belongs to a user's campaign scope. */
export interface RequestScopeRow {
  campaign_id: string | null;
}

/** A system grant covers every request; a campaign grant never covers the unassigned queue. */
export function canAccessRequest(session: Pick<ReporterSession, 'grants'>, permission: Permission, row: RequestScopeRow): boolean {
  return session.grants.some((grant) => {
    const permissions: readonly string[] = ROLE_PERMISSIONS[grant.role_code];
    if (!permissions.includes(permission)) return false;
    return grant.scope_type === 'SYSTEM' ||
      (grant.scope_type === 'CAMPAIGN' && Boolean(row.campaign_id) && grant.campaign_id === row.campaign_id);
  });
}

/** Rejects with `FORBIDDEN` unless `canAccessRequest` holds. */
export function assertRequestPermission(session: Pick<ReporterSession, 'grants'>, permission: Permission, row: RequestScopeRow): void {
  if (!canAccessRequest(session, permission, row)) throw new AppError('FORBIDDEN', { status: 403 });
}

/** SQL equivalent of canAccessRequest. Empty scope returns FALSE so list and aggregate endpoints return no rows. */
export function requestScopeFilter(grants: readonly Grant[], permission: Permission, values: unknown[], alias = 'r'): string {
  const branches = new Set<string>();
  for (const grant of grants) {
    const permissions: readonly string[] = ROLE_PERMISSIONS[grant.role_code];
    if (!permissions.includes(permission)) continue;
    if (grant.scope_type === 'SYSTEM') {
      branches.add('TRUE');
    } else if (grant.scope_type === 'CAMPAIGN' && grant.campaign_id) {
      values.push(grant.campaign_id);
      branches.add(`${alias}.campaign_id=$${values.length}`);
    }
  }
  return branches.size ? `(${[...branches].join(' OR ')})` : 'FALSE';
}
