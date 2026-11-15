import { describe, expect, it, jest } from '@jest/globals';
import { AddCampaignCoordinatorRole1794960000000 } from '../src/database/migrations/AddCampaignCoordinatorRole1794960000000';

describe('AddCampaignCoordinatorRole migration', () => {
  it('converts campaign-scoped coordinator grants to one SYSTEM secondary role per user', async () => {
    const query = jest.fn(async () => undefined);
    await new AddCampaignCoordinatorRole1794960000000().up({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("SET role_code='CAMPAIGN_COORDINATOR', scope_type='SYSTEM'"))).toBe(true);
    expect(statements.some((sql) => sql.includes('row_number() OVER (PARTITION BY user_id'))).toBe(true);
    expect(statements.some((sql) => sql.includes("'CAMPAIGN_COORDINATOR') AND scope_type = 'SYSTEM'"))).toBe(true);
  });

  it('restores the old role catalog and scope constraints on rollback', async () => {
    const query = jest.fn(async () => undefined);
    await new AddCampaignCoordinatorRole1794960000000().down({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("SET role_code='COORDINATOR'"))).toBe(true);
    expect(statements.some((sql) => sql.includes("'CITIZEN','VOLUNTEER','COORDINATOR','CAMPAIGN_MANAGER'"))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE UNIQUE INDEX role_grant_live_uq'))).toBe(true);
  });
});
