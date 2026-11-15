import { describe, expect, it, jest } from '@jest/globals';
import { AddCampaignEngagementAndSpatialMatching1794960000000 } from '../src/database/migrations/AddCampaignEngagementAndSpatialMatching1794960000000';

describe('campaign engagement and spatial matching migration', () => {
  it('creates retained engagements and spatial matching fields with constraints and indexes', async () => {
    const query = jest.fn(async () => undefined);
    await new AddCampaignEngagementAndSpatialMatching1794960000000().up({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes('CREATE TABLE campaign_engagement'))).toBe(true);
    expect(statements.some((sql) => sql.includes('WHERE ended_at IS NULL'))).toBe(true);
    expect(statements.some((sql) => sql.includes('GRANT SELECT, INSERT, UPDATE'))).toBe(true);
    expect(statements.some((sql) => sql.includes('REVOKE DELETE'))).toBe(true);
    expect(statements).toContain('ALTER TABLE campaign ADD COLUMN center geography(Point,4326)');
    expect(statements.some((sql) => sql.includes('BETWEEN 500 AND 300000'))).toBe(true);
    expect(statements.some((sql) => sql.includes('USING gist(center)'))).toBe(true);
    expect(statements.some((sql) => sql.includes("CASE WHEN campaign_id IS NULL THEN 'UNMATCHED' ELSE 'MANUAL' END"))).toBe(true);
  });

  it('drops added structures on rollback without touching request or mission history', async () => {
    const query = jest.fn(async () => undefined);
    await new AddCampaignEngagementAndSpatialMatching1794960000000().down({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toContain('DROP TABLE IF EXISTS campaign_engagement');
    expect(statements.some((sql) => sql.includes('DROP COLUMN IF EXISTS campaign_candidate_ids'))).toBe(true);
    expect(statements.some((sql) => /DELETE FROM (request_event|mission|campaign_engagement)/u.test(sql))).toBe(false);
  });
});
