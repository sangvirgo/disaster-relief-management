import type { EntityManager } from 'typeorm';

export interface CycleCampaignTarget {
  request_id: string;
  work_cycle: number;
  campaign_id: string | null;
}

/**
 * Copies a campaign onto a fulfillment cycle that was created while its SOS belonged to no campaign.
 *
 * Response lets the coordinator attach an unmatched SOS to a campaign later. The cycle's copied attribution normally stays
 * historical, but a cycle that only holds untouched proposals has nothing to keep historical: it is OPEN, has no live
 * intent, no DECLARED or CONFIRMED line and no commitment or supply request line. Only such a cycle adopts the campaign, so its
 * proposals reach the campaign's primary warehouse demand. Any other cycle keeps campaign_id NULL.
 *
 * Targets without a campaign are ignored. Returns the number of cycles updated.
 */
export async function adoptCycleCampaigns(
  manager: Pick<EntityManager, 'query'>,
  targets: readonly CycleCampaignTarget[],
): Promise<number> {
  const attached = targets.filter((target): target is CycleCampaignTarget & { campaign_id: string } => Boolean(target.campaign_id));
  if (attached.length === 0) return 0;
  const rows = await manager.query(
    `UPDATE fulfillment_cycle c SET campaign_id=t.campaign_id
       FROM unnest($1::uuid[],$2::int[],$3::uuid[]) AS t(request_id,work_cycle,campaign_id)
      WHERE c.request_id=t.request_id AND c.work_cycle=t.work_cycle
        AND c.campaign_id IS NULL AND c.state='OPEN'
        AND NOT EXISTS (SELECT 1 FROM cycle_intent i WHERE i.cycle_id=c.id AND i.state<>'ABORTED')
        AND NOT EXISTS (SELECT 1 FROM relief_need n WHERE n.cycle_id=c.id AND n.source<>'ESTIMATED')
        AND NOT EXISTS (SELECT 1 FROM relief_need n JOIN commitment m ON m.relief_need_id=n.id WHERE n.cycle_id=c.id)
        AND NOT EXISTS (SELECT 1 FROM relief_need n JOIN supply_request_line l ON l.relief_need_id=n.id WHERE n.cycle_id=c.id)
      RETURNING c.id`,
    [attached.map((target) => target.request_id), attached.map((target) => target.work_cycle), attached.map((target) => target.campaign_id)],
  ) as unknown;
  return countRows(rows);
}

function countRows(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  return Array.isArray(value[0]) ? value[0].length : value.length;
}
