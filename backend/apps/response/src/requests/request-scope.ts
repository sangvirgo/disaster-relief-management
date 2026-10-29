import { AppError } from '@c48/technical/errors/errors';
import { hasPermission, Permission } from '@c48/identity-contracts/permissions';
import type { ReporterSession } from './reporter-session';

/** The columns that place an assistance request inside a grant's organization, region, or campaign scope. */
export interface RequestScopeRow {
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
}

/** True when one of the session's grants gives `permission` over the request's organization/region/campaign. */
export function canAccessRequest(session: Pick<ReporterSession, 'grants'>, permission: Permission, row: RequestScopeRow): boolean {
  return hasPermission(session.grants, permission, {
    organizationId: row.organization_id,
    regionCode: row.region_code,
    campaignId: row.campaign_id,
  });
}

/** Rejects with `FORBIDDEN` unless `canAccessRequest` holds. */
export function assertRequestPermission(session: Pick<ReporterSession, 'grants'>, permission: Permission, row: RequestScopeRow): void {
  if (!canAccessRequest(session, permission, row)) throw new AppError('FORBIDDEN', { status: 403 });
}
