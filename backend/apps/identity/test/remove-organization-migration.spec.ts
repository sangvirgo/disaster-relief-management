import { jest } from '@jest/globals';
import { RemoveOrganizationIdentity1794787200000 } from '../src/database/migrations/RemoveOrganizationIdentity1794787200000';

describe('RemoveOrganizationIdentity migration', () => {
  it('backfills organization grants to system, deletes colliding live grants and removes the organization schema', async () => {
    const query = jest.fn(async (_sql: string) => []);
    await new RemoveOrganizationIdentity1794787200000().up({ query } as never);
    const statements = query.mock.calls.map(([sql]) => sql);

    expect(statements.some((sql) => sql.includes("SET scope_type = 'SYSTEM'"))).toBe(true);
    expect(statements.some((sql) => sql.includes('row_number() OVER') && sql.includes('PARTITION BY user_id, role_code'))).toBe(true);
    expect(statements.some((sql) => sql.includes("CASE WHEN scope_type = 'ORGANIZATION' THEN 'SYSTEM'"))).toBe(true);
    expect(statements).toContain('DROP TABLE IF EXISTS membership');
    expect(statements).toContain('DROP TABLE IF EXISTS organization');
    expect(statements).toContain('ALTER TABLE role_grant DROP COLUMN organization_id');
    expect(statements.some((sql) => sql.includes("CHECK (scope_type IN ('SYSTEM','CAMPAIGN'))"))).toBe(true);
  });

  it('restores nullable organization structures on rollback', async () => {
    const query = jest.fn(async (_sql: string) => []);
    await new RemoveOrganizationIdentity1794787200000().down({ query } as never);
    const statements = query.mock.calls.map(([sql]) => sql);

    expect(statements.some((sql) => sql.includes('CREATE TABLE organization'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TABLE membership'))).toBe(true);
    expect(statements).toContain('ALTER TABLE role_grant ADD COLUMN organization_id uuid REFERENCES organization(id)');
    expect(statements.some((sql) => sql.includes("scope_type = 'CAMPAIGN' AND campaign_id IS NOT NULL"))).toBe(true);
    expect(statements.some((sql) => sql.includes("role_code NOT IN ('ADMIN','CITIZEN','VOLUNTEER') AND scope_type IN ('SYSTEM','ORGANIZATION','CAMPAIGN')"))).toBe(true);
  });
});
