import { grantScopeIsValid, isSelfGrant } from '../src/grants/grant-scope';

describe('Identity grant scope shape', () => {
  it('accepts only role and scope pairs supported by the database contract', () => {
    expect(grantScopeIsValid({ role_code: 'ADMIN', scope_type: 'SYSTEM' })).toBe(true);
    expect(grantScopeIsValid({ role_code: 'VOLUNTEER', scope_type: 'SYSTEM' })).toBe(true);
    expect(grantScopeIsValid({ role_code: 'COORDINATOR', scope_type: 'SYSTEM' })).toBe(true);
    expect(grantScopeIsValid({ role_code: 'CAMPAIGN_MANAGER', scope_type: 'CAMPAIGN', campaign_id: 'campaign' })).toBe(true);
    expect(grantScopeIsValid({ role_code: 'ADMIN', scope_type: 'CAMPAIGN', campaign_id: 'campaign' })).toBe(false);
    expect(grantScopeIsValid({ role_code: 'COORDINATOR', scope_type: 'SYSTEM', campaign_id: 'campaign' })).toBe(false);
    expect(grantScopeIsValid({ role_code: 'COORDINATOR', scope_type: 'CAMPAIGN' })).toBe(false);
    expect(grantScopeIsValid({ role_code: 'CITIZEN', scope_type: 'CAMPAIGN', campaign_id: 'campaign' })).toBe(false);
  });

  it('compares UUID identity without case-sensitive bypasses', () => {
    expect(isSelfGrant('A0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001')).toBe(true);
    expect(isSelfGrant('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002')).toBe(false);
  });
});
