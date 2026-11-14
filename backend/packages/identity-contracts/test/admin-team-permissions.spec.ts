import { hasPermission, type Grant } from '../src/permissions';

const admin: Grant = { role_code: 'ADMIN', scope_type: 'SYSTEM' };
const coordinator: Grant = { role_code: 'COORDINATOR', scope_type: 'SYSTEM' };
const campaignCoordinator: Grant = { role_code: 'COORDINATOR', scope_type: 'CAMPAIGN', campaign_id: 'campaign-a' };

describe('team setup authorization', () => {
  it('allows system-scoped team access without granting rescue dispatch', () => {
    expect(hasPermission([admin], 'TEAM_READ', {})).toBe(true);
    expect(hasPermission([admin], 'TEAM_MANAGE_ANY', {})).toBe(true);
    expect(hasPermission([admin], 'REQUEST_DETAIL_READ', { campaignId: 'campaign-a' })).toBe(false);
    expect(hasPermission([admin], 'MISSION_ASSIGN', { campaignId: 'campaign-a' })).toBe(false);
  });

  it('allows a system coordinator to manage shared teams and confines campaign grants to their campaign', () => {
    expect(hasPermission([coordinator], 'TEAM_MANAGE_ANY', {})).toBe(true);
    expect(hasPermission([campaignCoordinator], 'REQUEST_DETAIL_READ', { campaignId: 'campaign-a' })).toBe(true);
    expect(hasPermission([campaignCoordinator], 'REQUEST_DETAIL_READ', { campaignId: 'campaign-b' })).toBe(false);
    expect(hasPermission([campaignCoordinator], 'REQUEST_DETAIL_READ', { campaignId: null })).toBe(false);
    expect(hasPermission([campaignCoordinator], 'TEAM_MANAGE_ANY', {})).toBe(false);
  });
});
