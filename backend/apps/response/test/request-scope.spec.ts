import { describe, expect, it } from '@jest/globals';
import type { Grant } from '@c48/identity-contracts/permissions';
import { assertRequestPermission, canAccessRequest, requestScopeFilter } from '../src/requests/request-scope';

const campaignA = '00000000-0000-4000-8000-0000000000a1';
const campaignB = '00000000-0000-4000-8000-0000000000b2';
const campaignGrant: Grant = { role_code: 'COORDINATOR', scope_type: 'CAMPAIGN', campaign_id: campaignA };
const systemGrant: Grant = { role_code: 'COORDINATOR', scope_type: 'SYSTEM' };

describe('assistance request grant scope', () => {
  it('limits a campaign coordinator to that campaign and excludes unassigned requests', () => {
    const session = { grants: [campaignGrant] };
    expect(canAccessRequest(session, 'REQUEST_QUEUE_READ', { campaign_id: campaignA })).toBe(true);
    expect(canAccessRequest(session, 'REQUEST_QUEUE_READ', { campaign_id: campaignB })).toBe(false);
    expect(canAccessRequest(session, 'REQUEST_QUEUE_READ', { campaign_id: null })).toBe(false);
  });

  it('allows a system coordinator to see unassigned and campaign requests', () => {
    const session = { grants: [systemGrant] };
    expect(canAccessRequest(session, 'REQUEST_QUEUE_READ', { campaign_id: null })).toBe(true);
    expect(canAccessRequest(session, 'REQUEST_QUEUE_READ', { campaign_id: campaignA })).toBe(true);
  });

  it('denies campaign-only verification and assignment for an unassigned request', () => {
    const session = { grants: [campaignGrant] };
    const request = { campaign_id: null };
    expect(canAccessRequest(session, 'REQUEST_VERIFY', request)).toBe(false);
    expect(canAccessRequest(session, 'MISSION_ASSIGN', request)).toBe(false);
    expect(() => assertRequestPermission(session, 'REQUEST_VERIFY', request)).toThrow('FORBIDDEN');
  });

  it('builds list filters from campaign grants and returns no scope for no matching grant', () => {
    const values: unknown[] = [];
    expect(requestScopeFilter([campaignGrant], 'REQUEST_QUEUE_READ', values)).toBe('(r.campaign_id=$1)');
    expect(values).toEqual([campaignA]);
    expect(requestScopeFilter([], 'REQUEST_QUEUE_READ', [])).toBe('FALSE');
  });

  it('does not require a campaign filter for system-wide heatmap and report scope', () => {
    expect(requestScopeFilter([systemGrant], 'MAP_READ', [])).toBe('(TRUE)');
    expect(requestScopeFilter([systemGrant], 'REPORT_READ', [])).toBe('(TRUE)');
  });
});
