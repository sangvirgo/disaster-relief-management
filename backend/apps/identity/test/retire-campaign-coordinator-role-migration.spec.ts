import 'reflect-metadata';
import { describe, expect, it, jest } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ROLE_PERMISSIONS, validGrant } from '@c48/identity-contracts/permissions';
import { RetireCampaignCoordinatorRole1795132800000 } from '../src/database/migrations/RetireCampaignCoordinatorRole1795132800000';
import { CreateGrantDto } from '../src/grants/grants.dto';

describe('RetireCampaignCoordinatorRole migration', () => {
  it('deletes the retired grants, bumps authz versions and narrows the role catalog', async () => {
    const query = jest.fn(async () => undefined);
    await new RetireCampaignCoordinatorRole1795132800000().up({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes('authz_version = authz_version + 1'))).toBe(true);
    expect(statements.some((sql) => sql.includes("DELETE FROM role_grant WHERE role_code = 'CAMPAIGN_COORDINATOR'"))).toBe(true);
    const checks = statements.filter((sql) => sql.includes('ADD CONSTRAINT'));
    expect(checks).toHaveLength(2);
    for (const check of checks) expect(check).not.toContain('CAMPAIGN_COORDINATOR');
  });

  it('restores the role catalog on rollback without restoring deleted grants', async () => {
    const query = jest.fn(async () => undefined);
    await new RetireCampaignCoordinatorRole1795132800000().down({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.filter((sql) => sql.includes('ADD CONSTRAINT') && sql.includes("'CAMPAIGN_COORDINATOR'"))).toHaveLength(2);
    expect(statements.some((sql) => sql.includes('DELETE FROM'))).toBe(false);
  });

  it('is absent from the permission catalog and rejected at the transport edge', () => {
    expect(Object.keys(ROLE_PERMISSIONS)).not.toContain('CAMPAIGN_COORDINATOR');
    expect(validGrant({ role_code: 'CAMPAIGN_COORDINATOR', scope_type: 'SYSTEM' })).toBe(false);
    const dto = plainToInstance(CreateGrantDto, { role_code: 'CAMPAIGN_COORDINATOR', scope_type: 'SYSTEM', reason: 'kiểm thử' });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
});
