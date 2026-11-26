import { describe, expect, it, jest } from '@jest/globals';
import { AllowSubCoordinatorGrant1795694400000 } from '../src/database/migrations/AllowSubCoordinatorGrant1795694400000';
import { grantScopeIsValid } from '../src/grants/grant-scope';

describe('AllowSubCoordinatorGrant migration', () => {
  it('allows a campaign-scoped COORDINATOR grant without a campaign only', async () => {
    const query = jest.fn(async () => undefined);
    await new AllowSubCoordinatorGrant1795694400000().up({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes("campaign_id IS NOT NULL OR role_code = 'COORDINATOR'"))).toBe(true);
    expect(statements.some((sql) => /INSERT|DELETE/u.test(sql))).toBe(false);
  });

  it('revokes floating grants and bumps authz versions on rollback', async () => {
    const query = jest.fn(async () => undefined);
    await new AllowSubCoordinatorGrant1795694400000().down({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));
    expect(statements.some((sql) => sql.includes('authz_version = authz_version + 1'))).toBe(true);
    expect(statements.some((sql) => sql.includes('UPDATE role_grant SET revoked_at = now()'))).toBe(true);
  });

  it('accepts the shape in the admin grant validation', () => {
    expect(grantScopeIsValid({ role_code: 'COORDINATOR', scope_type: 'CAMPAIGN' })).toBe(true);
    expect(grantScopeIsValid({ role_code: 'OPERATIONS_MANAGER', scope_type: 'CAMPAIGN' })).toBe(false);
  });
});
