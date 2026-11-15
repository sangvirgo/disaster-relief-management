import { describe, expect, it } from '@jest/globals';
import { ROLE_PERMISSIONS, validGrant } from '@c48/identity-contracts/permissions';
import { grantScopeIsValid } from '../src/grants/grant-scope';

const campaignId = '00000000-0000-4000-8000-0000000000a1';

describe('campaign coordinator grant scope', () => {
  it('accepts a system grant and rejects a campaign grant at both transport and service validation', () => {
    expect(grantScopeIsValid({ role_code: 'CAMPAIGN_COORDINATOR', scope_type: 'SYSTEM' })).toBe(true);
    expect(validGrant({ role_code: 'CAMPAIGN_COORDINATOR', scope_type: 'SYSTEM' })).toBe(true);
    expect(grantScopeIsValid({ role_code: 'CAMPAIGN_COORDINATOR', scope_type: 'CAMPAIGN', campaign_id: campaignId })).toBe(false);
    expect(validGrant({ role_code: 'CAMPAIGN_COORDINATOR', scope_type: 'CAMPAIGN', campaign_id: campaignId })).toBe(false);
  });

  it('keeps the secondary role out of campaign management, takeover, common queue, and Logistics', () => {
    const permissions = ROLE_PERMISSIONS.CAMPAIGN_COORDINATOR as readonly string[];
    for (const forbidden of ['CAMPAIGN_MANAGE', 'REQUEST_UNASSIGNED_QUEUE', 'TAKEOVER', 'REPORT_READ', 'NEED_MANAGE', 'DISTRIBUTION_PREPARE', 'ASSET_MANAGE']) {
      expect(permissions).not.toContain(forbidden);
    }
    expect(permissions).toContain('RESPONSE_REPORT_READ');
    expect(permissions).toContain('MISSION_ASSIGN');
    expect(permissions).toContain('TEAM_READ');
  });
});
