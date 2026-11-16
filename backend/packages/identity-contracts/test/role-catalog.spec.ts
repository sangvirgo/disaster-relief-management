import { hasPermission, ROLE_PERMISSIONS, type Grant } from '../src/permissions';

describe('role catalog after retiring staff roles', () => {
  it('no longer defines the retired staff roles', () => {
    expect(Object.keys(ROLE_PERMISSIONS)).not.toEqual(expect.arrayContaining(['CAMPAIGN_MANAGER', 'INTAKE_STAFF', 'DISTRIBUTION_STAFF']));
  });

  it('gives the primary coordinator the donation drive permission absorbed from campaign managers', () => {
    expect(ROLE_PERMISSIONS.COORDINATOR).toContain('DONATION_DRIVE_MANAGE');
    expect(ROLE_PERMISSIONS.COORDINATOR).toContain('CAMPAIGN_MANAGE');
  });

  it('keeps the operations manager as the union of the retired intake and distribution duties', () => {
    for (const permission of ['DONATION_INTAKE', 'DISTRIBUTION_PREPARE', 'DISTRIBUTION_DISPATCH', 'HANDOFF_RECORD', 'STOCK_ADJUST_REQUEST'] as const) {
      expect(ROLE_PERMISSIONS.OPERATIONS_MANAGER).toContain(permission);
    }
  });

  it('keeps reviewers from dispatching or recording handoffs', () => {
    expect(ROLE_PERMISSIONS.REVIEWER).not.toContain('DISTRIBUTION_DISPATCH');
    expect(ROLE_PERMISSIONS.REVIEWER).not.toContain('HANDOFF_RECORD');
  });

  it('confines a campaign-scoped operations manager to its own campaign', () => {
    const grant: Grant = { role_code: 'OPERATIONS_MANAGER', scope_type: 'CAMPAIGN', campaign_id: 'campaign-a' };
    expect(hasPermission([grant], 'DISTRIBUTION_DISPATCH', { campaignId: 'campaign-a' })).toBe(true);
    expect(hasPermission([grant], 'DISTRIBUTION_DISPATCH', { campaignId: 'campaign-b' })).toBe(false);
    expect(hasPermission([grant], 'HANDOFF_RECORD', { campaignId: null })).toBe(false);
  });

  it('lets only a system-scoped operations manager reach catalog-wide permissions through SYSTEM scope', () => {
    const system: Grant = { role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' };
    const campaign: Grant = { role_code: 'OPERATIONS_MANAGER', scope_type: 'CAMPAIGN', campaign_id: 'campaign-a' };
    expect(hasPermission([system], 'CATALOG_MANAGE', {})).toBe(true);
    expect(hasPermission([system], 'DISTRIBUTION_DISPATCH', { campaignId: 'campaign-b' })).toBe(true);
    expect(hasPermission([campaign], 'DONATION_INTAKE', { campaignId: 'campaign-b' })).toBe(false);
  });
});
