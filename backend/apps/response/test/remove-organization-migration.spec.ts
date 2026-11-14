import { describe, expect, it, jest } from '@jest/globals';
import { RemoveOrganizationResponse1794787200000 } from '../src/database/migrations/RemoveOrganizationResponse1794787200000';

describe('RemoveOrganizationResponse migration', () => {
  it('drops organization dependencies and adds shared FIFO and attention indexes', async () => {
    const query = jest.fn(async () => undefined);
    await new RemoveOrganizationResponse1794787200000().up({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("proc.prosrc ILIKE '%organization%'"))).toBe(true);
    expect(statements.some((sql) => sql.includes("pg_get_constraintdef(con.oid) ILIKE '%organization_id%'"))).toBe(true);
    expect(statements).toContain('ALTER TABLE assistance_request DROP COLUMN organization_id');
    expect(statements).toContain('ALTER TABLE campaign DROP COLUMN organization_id');
    expect(statements).toContain('ALTER TABLE rescue_team DROP COLUMN organization_id');
    expect(statements.some((sql) => sql.includes('CREATE INDEX request_fifo_idx ON assistance_request (received_at,id)'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE INDEX request_campaign_fifo_idx ON assistance_request (campaign_id,status,received_at,id)'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE INDEX request_campaign_attention_idx ON assistance_request (campaign_id,status,received_at,id)'))).toBe(true);
  });

  it('restores nullable organization columns and the previous request index shape', async () => {
    const query = jest.fn(async () => undefined);
    await new RemoveOrganizationResponse1794787200000().down({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements).toContain('ALTER TABLE assistance_request ADD COLUMN organization_id uuid');
    expect(statements).toContain('ALTER TABLE campaign ADD COLUMN organization_id uuid');
    expect(statements).toContain('ALTER TABLE rescue_team ADD COLUMN organization_id uuid');
    expect(statements.some((sql) => sql.includes('CREATE INDEX request_org_fifo_idx'))).toBe(true);
    expect(statements).toContain('DROP INDEX IF EXISTS request_campaign_fifo_idx');
  });
});
