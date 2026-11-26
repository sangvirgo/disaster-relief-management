import { describe, expect, it } from '@jest/globals';
import { hasPermission, isSubCoordinator, isSubCoordinatorGrant, SUB_COORDINATOR_PERMISSIONS, validGrant, type Grant } from '../src/permissions';

const campaignA = '00000000-0000-4000-8000-0000000000a1';
const floating: Grant = { role_code: 'COORDINATOR', scope_type: 'CAMPAIGN', campaign_id: null };

describe('sub-coordinator grant', () => {
  it('is the COORDINATOR role at CAMPAIGN scope without a campaign, not a new role', () => {
    expect(validGrant(floating)).toBe(true);
    expect(validGrant({ role_code: 'OPERATIONS_MANAGER', scope_type: 'CAMPAIGN', campaign_id: null })).toBe(false);
    expect(validGrant({ ...floating, engaged: true })).toBe(false);
    expect(isSubCoordinatorGrant(floating)).toBe(true);
    expect(isSubCoordinator([floating])).toBe(true);
    expect(isSubCoordinator([floating, { role_code: 'COORDINATOR', scope_type: 'SYSTEM' }])).toBe(false);
  });

  it('grants nothing by itself and only the narrow set through an engaged campaign', () => {
    expect(hasPermission([floating], 'REQUEST_VERIFY', { campaignId: campaignA })).toBe(false);
    expect(hasPermission([floating], 'CAMPAIGN_SETUP_MANAGE', { campaignId: null })).toBe(false);
    const engaged: Grant = { role_code: 'COORDINATOR', scope_type: 'CAMPAIGN', campaign_id: campaignA, engaged: true };
    expect(hasPermission([engaged], 'REQUEST_VERIFY', { campaignId: campaignA })).toBe(true);
    for (const permission of ['REQUEST_CREATE_PROXY', 'REQUEST_UNASSIGNED_QUEUE', 'CAMPAIGN_SETUP_MANAGE', 'NEED_MANAGE', 'DONATION_INTAKE'] as const) {
      expect(hasPermission([engaged], permission, { campaignId: campaignA })).toBe(false);
    }
    expect(SUB_COORDINATOR_PERMISSIONS).not.toContain('REQUEST_UNASSIGNED_QUEUE');
  });
});
