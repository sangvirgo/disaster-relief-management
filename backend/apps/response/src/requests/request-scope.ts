import { AppError } from '@c48/technical/errors/errors';
import { Permission, ROLE_PERMISSIONS, Grant } from '@c48/identity-contracts/permissions';
import type { ReporterSession } from './reporter-session';
import { engagementActiveSql } from './engagement-ttl';

/** The fields used to decide whether a request belongs to a user's campaign scope. */
export interface RequestScopeRow {
  campaign_id: string | null;
  activeCampaignIds?: readonly string[];
}

/** A system grant covers every request; a campaign grant never covers the unassigned queue. */
export function canAccessRequest(session: Pick<ReporterSession, 'grants'> & Partial<Pick<ReporterSession, 'activeCampaignIds'>>, permission: Permission, row: RequestScopeRow): boolean {
  return session.grants.some((grant) => {
    const permissions: readonly string[] = ROLE_PERMISSIONS[grant.role_code];
    if (!permissions.includes(permission)) return false;
    if (grant.role_code === 'CAMPAIGN_COORDINATOR') {
      return grant.scope_type === 'SYSTEM' && Boolean(row.campaign_id && session.activeCampaignIds?.includes(row.campaign_id));
    }
    return grant.scope_type === 'SYSTEM' ||
      (grant.scope_type === 'CAMPAIGN' && Boolean(row.campaign_id) && grant.campaign_id === row.campaign_id);
  });
}

/** Rejects with `FORBIDDEN` unless `canAccessRequest` holds. */
export function assertRequestPermission(session: Pick<ReporterSession, 'grants'> & Partial<Pick<ReporterSession, 'activeCampaignIds'>>, permission: Permission, row: RequestScopeRow): void {
  if (canAccessRequest(session, permission, row)) return;
  const campaignCoordinatorWithoutEngagement = session.grants.some((grant) => grant.role_code === 'CAMPAIGN_COORDINATOR') &&
    !session.activeCampaignIds?.length;
  throw new AppError('FORBIDDEN', {
    status: 403,
    ...(campaignCoordinatorWithoutEngagement
      ? { userMessage: 'Hãy chọn một chiến dịch để bắt đầu điều phối trước khi xử lý hồ sơ.' }
      : {}),
  });
}

/** SQL equivalent of canAccessRequest. Empty scope returns FALSE so list and aggregate endpoints return no rows. */
export function requestScopeFilter(grants: readonly Grant[], permission: Permission, values: unknown[], alias = 'r', userId?: string): string {
  const branches = new Set<string>();
  for (const grant of grants) {
    const permissions: readonly string[] = ROLE_PERMISSIONS[grant.role_code];
    if (!permissions.includes(permission)) continue;
    if (grant.role_code === 'CAMPAIGN_COORDINATOR') {
      if (grant.scope_type !== 'SYSTEM') continue;
      if (!userId) continue;
      values.push(userId);
      branches.add(`EXISTS (SELECT 1 FROM campaign_engagement ce WHERE ce.user_id=$${values.length} AND ce.campaign_id=${alias}.campaign_id AND ${engagementActiveSql('ce')})`);
      continue;
    }
    if (grant.scope_type === 'SYSTEM') {
      branches.add('TRUE');
    } else if (grant.scope_type === 'CAMPAIGN' && grant.campaign_id) {
      values.push(grant.campaign_id);
      branches.add(`${alias}.campaign_id=$${values.length}`);
    }
  }
  return branches.size ? `(${[...branches].join(' OR ')})` : 'FALSE';
}
