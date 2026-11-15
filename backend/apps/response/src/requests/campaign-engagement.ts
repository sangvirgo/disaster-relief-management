import { AppError } from '@c48/technical/errors/errors';
import type { Grant } from '@c48/identity-contracts/permissions';
import type { EntityManager } from 'typeorm';
import { engagementActiveSql } from './engagement-ttl';

export async function refreshCampaignEngagement(
  manager: Pick<EntityManager, 'query'>,
  requestId: string,
  userId: string,
  grants: readonly Grant[],
): Promise<void> {
  if (!grants.some((grant) => grant.role_code === 'CAMPAIGN_COORDINATOR' && grant.scope_type === 'SYSTEM')) return;
  const updated = await manager.query(
    `UPDATE campaign_engagement ce SET last_active_at=clock_timestamp()
       FROM assistance_request r
      WHERE r.id=$1 AND r.campaign_id=ce.campaign_id AND ce.user_id=$2 AND ${engagementActiveSql('ce')}
      RETURNING ce.id`, [requestId, userId],
  ) as Array<{ id: string }>;
  if (!updated.length) {
    throw new AppError('FORBIDDEN', { status: 403, userMessage: 'Hãy chọn một chiến dịch để bắt đầu điều phối trước khi xử lý hồ sơ.' });
  }
}
