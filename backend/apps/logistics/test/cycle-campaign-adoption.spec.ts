import { describe, expect, it, jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import { adoptCycleCampaigns } from '../src/fulfillment-cycles/cycle-campaign-adoption';

const requestId = '11111111-1111-4111-8111-111111111111';
const campaignId = '22222222-2222-4222-8222-222222222222';

function fake(rows: unknown[]) {
  const query = jest.fn(async (..._args: unknown[]) => rows);
  return { manager: { query } as unknown as Pick<EntityManager, 'query'>, query };
}

describe('adoptCycleCampaigns', () => {
  it('ignores targets without a campaign and issues no SQL', async () => {
    const { manager, query } = fake([]);
    await expect(adoptCycleCampaigns(manager, [{ request_id: requestId, work_cycle: 1, campaign_id: null }])).resolves.toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('only updates an OPEN cycle with no campaign, no live intent and only untouched proposals', async () => {
    const { manager, query } = fake([{ id: 'c1' }]);
    await expect(adoptCycleCampaigns(manager, [{ request_id: requestId, work_cycle: 2, campaign_id: campaignId }])).resolves.toBe(1);
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('c.campaign_id IS NULL');
    expect(sql).toContain("c.state='OPEN'");
    expect(sql).toContain("i.state<>'ABORTED'");
    expect(sql).toContain("n.source<>'ESTIMATED'");
    expect(sql).toContain('commitment m');
    expect(sql).toContain('pickup_ticket_line');
    expect(values).toEqual([[requestId], [2], [campaignId]]);
  });

  it('counts rows returned by a driver that wraps them with a row count', async () => {
    const { manager } = fake([[{ id: 'c1' }, { id: 'c2' }], 2]);
    await expect(adoptCycleCampaigns(manager, [{ request_id: requestId, work_cycle: 1, campaign_id: campaignId }])).resolves.toBe(2);
  });
});
