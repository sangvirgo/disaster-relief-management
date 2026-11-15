import { describe, expect, it, jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import type { CampaignConflictNotifier } from '../src/requests/campaign-conflict-notifier.token';
import { applyAutomaticCampaignMatch } from '../src/operations/request-campaign-attribution';

const requestId = '00000000-0000-4000-8000-0000000000a1';
const campaignA = '00000000-0000-4000-8000-0000000000b2';
const campaignB = '00000000-0000-4000-8000-0000000000c3';

function fixture(campaigns: Array<{ id: string; name: string }>) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const manager = {
    query: jest.fn(async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes('SELECT c.id,c.name')) return campaigns;
      if (sql.includes('UPDATE assistance_request')) return [[{
        id: requestId, status: 'SUBMITTED', version: 2,
        campaign_id: campaigns.length === 1 ? campaignA : null,
        campaign_match_state: campaigns.length === 1 ? 'AUTO_ATTACHED' : 'CONFLICT',
        campaign_candidate_ids: campaigns.length > 1 ? campaigns.map(({ id }) => id) : null,
      }], 1];
      if (sql.includes('INSERT INTO request_event')) return [{ id: '00000000-0000-4000-8000-0000000000d4' }];
      return [];
    }),
  } as unknown as EntityManager;
  return { manager, queries };
}

const input = { requestId, trackingCode: 'C48SOS0001', status: 'SUBMITTED', version: 1 };

describe('automatic campaign matching', () => {
  it('auto-attaches to the single ACTIVE campaign in the PostGIS radius and audits it', async () => {
    const { manager, queries } = fixture([{ id: campaignA, name: 'Chiến dịch miền Trung' }]);

    await applyAutomaticCampaignMatch(manager, input);

    const matchQuery = queries[0]!;
    expect(matchQuery.sql).toContain("c.status='ACTIVE'");
    expect(matchQuery.sql).toContain('c.center IS NOT NULL AND c.radius_m IS NOT NULL');
    expect(matchQuery.sql).toContain('ST_DWithin(s.location,c.center,c.radius_m)');
    expect(queries[1]?.sql).toContain('SET campaign_id=$2,campaign_match_state=$3,campaign_candidate_ids=$4::uuid[]');
    expect(queries[1]?.values).toEqual([requestId, campaignA, 'AUTO_ATTACHED', null, 1]);
    expect(queries[2]?.values).toContain('CAMPAIGN_AUTO_ATTACHED');
    expect(queries.some(({ sql }) => sql.includes('INSERT INTO audit_log'))).toBe(true);
    expect(queries[1]?.sql).not.toMatch(/priority\s*=|INSERT INTO mission/u);
  });

  it('marks overlapping campaigns CONFLICT, stores every candidate, and sends one notice per primary coordinator', async () => {
    const { manager, queries } = fixture([
      { id: campaignA, name: 'Chiến dịch A' }, { id: campaignB, name: 'Chiến dịch B' },
    ]);
    const notifier: CampaignConflictNotifier = {
      requestCoordinatorGrants: jest.fn(async () => [
        { user_id: '00000000-0000-4000-8000-0000000000e5', scope_type: 'SYSTEM' },
        { user_id: '00000000-0000-4000-8000-0000000000f6', scope_type: 'CAMPAIGN' },
        { user_id: '00000000-0000-4000-8000-0000000000e5', scope_type: 'SYSTEM' },
      ]),
    };

    await applyAutomaticCampaignMatch(manager, input, notifier);

    expect(queries[1]?.values).toEqual([requestId, null, 'CONFLICT', [campaignA, campaignB], 1]);
    expect(queries[2]?.values).toContain('CAMPAIGN_MATCH_CONFLICT');
    const notice = queries.find(({ sql }) => sql.includes('INSERT INTO notice'));
    expect(notice?.sql).toContain("ON CONFLICT (source_id,source_version,recipient_user_id,notice_type) DO NOTHING");
    expect(notice?.sql).toContain("'request_id',$1::uuid");
    expect(notice?.values?.[2]).toEqual(['00000000-0000-4000-8000-0000000000e5']);
    expect(notice?.values?.[3]).toBe('SOS C48SOS0001 nằm trong vùng của nhiều chiến dịch (Chiến dịch A, Chiến dịch B). Cần điều phối chính chọn chiến dịch.');
  });

  it('leaves requests unmatched when no campaign qualifies and never matches a closed request', async () => {
    const { manager, queries } = fixture([]);
    await applyAutomaticCampaignMatch(manager, input);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.sql).toContain('ST_DWithin');

    const closed = fixture([{ id: campaignA, name: 'Không được dùng' }]);
    await applyAutomaticCampaignMatch(closed.manager, { ...input, status: 'RESOLVED' });
    expect(closed.queries).toHaveLength(0);
  });
});
