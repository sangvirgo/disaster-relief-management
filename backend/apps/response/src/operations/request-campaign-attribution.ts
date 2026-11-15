import type { EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import type { CampaignConflictNotifier } from '../requests/campaign-conflict-notifier.token';

function resultRows<T>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return Array.isArray(value[0]) ? value[0] as T[] : value as T[];
}

export interface CampaignAttributionRow {
  id: string;
  status: string;
  version: number;
  campaign_id: string | null;
  campaign_match_state: string;
  campaign_candidate_ids: string[] | null;
}

export async function updateCampaignAttribution(
  manager: Pick<EntityManager, 'query'>,
  row: CampaignAttributionRow,
  input: {
    campaignId: string | null;
    matchState: 'AUTO_ATTACHED' | 'CONFLICT' | 'MANUAL';
    candidateIds?: string[] | null;
    actorId: string | null;
    eventType: string;
    auditAction: string;
    reason: string;
    payload?: Record<string, unknown>;
  },
): Promise<{ row: CampaignAttributionRow; eventId: string }> {
  const candidateIds = input.candidateIds ?? null;
  const updated = resultRows<CampaignAttributionRow>(await manager.query(
    `UPDATE assistance_request
        SET campaign_id=$2,campaign_match_state=$3,campaign_candidate_ids=$4::uuid[],version=version+1
      WHERE id=$1 AND version=$5
      RETURNING id,status,version,campaign_id,campaign_match_state,campaign_candidate_ids`,
    [row.id, input.campaignId, input.matchState, candidateIds, row.version],
  ));
  const next = updated[0];
  if (!next) throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(row.version) } });

  const payload = {
    previous_campaign_id: row.campaign_id,
    campaign_id: next.campaign_id,
    campaign_match_state: next.campaign_match_state,
    campaign_candidate_ids: next.campaign_candidate_ids,
    ...input.payload,
  };
  const events = resultRows<{ id: string }>(await manager.query(
    `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,payload)
     VALUES ($1,$2,$3,'STAFF',$4,$4,$5::jsonb) RETURNING id`,
    [row.id, input.actorId, input.eventType, row.status, JSON.stringify(payload)],
  ));
  if (!events[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });

  await manager.query(
    `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
     VALUES ($1,$2,'assistance_request',$3,$4::jsonb,$5::jsonb,$6)`,
    [input.actorId, input.auditAction, row.id,
      JSON.stringify({ campaign_id: row.campaign_id, campaign_match_state: row.campaign_match_state, campaign_candidate_ids: row.campaign_candidate_ids }),
      JSON.stringify({ campaign_id: next.campaign_id, campaign_match_state: next.campaign_match_state, campaign_candidate_ids: next.campaign_candidate_ids }),
      input.reason],
  );
  return { row: next, eventId: events[0].id };
}

export async function applyAutomaticCampaignMatch(
  manager: Pick<EntityManager, 'query'>,
  input: { requestId: string; trackingCode: string; status: string; version: number },
  conflictNotifier?: CampaignConflictNotifier,
): Promise<void> {
  if (['REJECTED', 'DUPLICATE', 'RESOLVED', 'CLOSED', 'CANCELLED'].includes(input.status)) return;
  const campaigns = resultRows<{ id: string; name: string }>(await manager.query(
    `SELECT c.id,c.name
       FROM campaign c JOIN request_subject s ON s.request_id=$1
      WHERE c.status='ACTIVE' AND c.center IS NOT NULL AND c.radius_m IS NOT NULL
        AND ST_DWithin(s.location,c.center,c.radius_m)
      ORDER BY c.id`, [input.requestId],
  ));
  if (!campaigns.length) return;
  const row: CampaignAttributionRow = {
    id: input.requestId, status: input.status, version: input.version,
    campaign_id: null, campaign_match_state: 'UNMATCHED', campaign_candidate_ids: null,
  };
  if (campaigns.length === 1) {
    await updateCampaignAttribution(manager, row, {
      campaignId: campaigns[0]!.id,
      matchState: 'AUTO_ATTACHED',
      actorId: null,
      eventType: 'CAMPAIGN_AUTO_ATTACHED',
      auditAction: 'CAMPAIGN_AUTO_ATTACHED',
      reason: 'ACTIVE_CAMPAIGN_WITHIN_RADIUS',
      payload: { campaign_name: campaigns[0]!.name, matching_rule: 'POSTGIS_RADIUS' },
    });
    return;
  }

  const candidateIds = campaigns.map((campaign) => campaign.id);
  await updateCampaignAttribution(manager, row, {
    campaignId: null,
    matchState: 'CONFLICT',
    candidateIds,
    actorId: null,
    eventType: 'CAMPAIGN_MATCH_CONFLICT',
    auditAction: 'CAMPAIGN_MATCH_CONFLICT',
    reason: 'MULTIPLE_ACTIVE_CAMPAIGNS_WITHIN_RADIUS',
    payload: { campaign_names: campaigns.map((campaign) => campaign.name), matching_rule: 'POSTGIS_RADIUS' },
  });

  if (!conflictNotifier) return;
  const coordinators = await conflictNotifier.requestCoordinatorGrants(null);
  const recipients = [...new Set(coordinators.filter((grant) => grant.scope_type === 'SYSTEM').map((grant) => grant.user_id))];
  if (!recipients.length) return;
  const noticeMessage = `SOS ${input.trackingCode} nằm trong vùng của nhiều chiến dịch (${campaigns.map((campaign) => campaign.name).join(', ')}). Cần điều phối chính chọn chiến dịch.`;
  await manager.query(
    `INSERT INTO notice (source_id,source_version,recipient_user_id,notice_type,payload)
     SELECT $1,$2,recipient,'CAMPAIGN_MATCH_CONFLICT',jsonb_build_object(
       'text_code','CAMPAIGN_MATCH_CONFLICT','request_id',$1::uuid,'message',$4::text,'campaign_ids',$5::jsonb)
       FROM unnest($3::uuid[]) AS recipient
     ON CONFLICT (source_id,source_version,recipient_user_id,notice_type) DO NOTHING`,
    [input.requestId, input.version + 1, recipients, noticeMessage, JSON.stringify(candidateIds)],
  );
}
