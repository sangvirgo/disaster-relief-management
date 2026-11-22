import { hasPermission, ROLE_PERMISSIONS, type Grant } from '../src/permissions';

describe('role catalog after retiring staff roles', () => {
  it('no longer defines the retired staff roles', () => {
    expect(Object.keys(ROLE_PERMISSIONS)).not.toEqual(expect.arrayContaining(['CAMPAIGN_MANAGER', 'INTAKE_STAFF', 'DISTRIBUTION_STAFF']));
  });

  it('reserves donation drive management for the operations manager', () => {
    expect(ROLE_PERMISSIONS.COORDINATOR).toContain('CAMPAIGN_MANAGE');
    expect(ROLE_PERMISSIONS.OPERATIONS_MANAGER).toContain('DONATION_DRIVE_MANAGE');
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      if (role === 'OPERATIONS_MANAGER') continue;
      expect(ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS]).not.toContain('DONATION_DRIVE_MANAGE');
    }
  });

  it('keeps campaign setup (create, activate, area change) with the coordinator only', () => {
    expect(ROLE_PERMISSIONS.COORDINATOR).toContain('CAMPAIGN_SETUP_MANAGE');
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      if (role === 'COORDINATOR') continue;
      expect(ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS]).not.toContain('CAMPAIGN_SETUP_MANAGE');
    }
    const coordinator: Grant = { role_code: 'COORDINATOR', scope_type: 'SYSTEM' };
    const manager: Grant = { role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' };
    expect(hasPermission([coordinator], 'CAMPAIGN_SETUP_MANAGE', { campaignId: null })).toBe(true);
    expect(hasPermission([manager], 'CAMPAIGN_SETUP_MANAGE', { campaignId: null })).toBe(false);
  });

  it('lets coordinators read campaign warehouse assignments but reserves changes for the operations manager', () => {
    expect(ROLE_PERMISSIONS.COORDINATOR).toContain('CAMPAIGN_WAREHOUSE_VIEW');
    expect(ROLE_PERMISSIONS.OPERATIONS_MANAGER).toContain('CAMPAIGN_WAREHOUSE_VIEW');
    expect(ROLE_PERMISSIONS.OPERATIONS_MANAGER).toContain('CAMPAIGN_WAREHOUSE_MANAGE');
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      if (role === 'OPERATIONS_MANAGER') continue;
      expect(ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS]).not.toContain('CAMPAIGN_WAREHOUSE_MANAGE');
    }
    const coordinator: Grant = { role_code: 'COORDINATOR', scope_type: 'SYSTEM' };
    expect(hasPermission([coordinator], 'CAMPAIGN_WAREHOUSE_MANAGE', { campaignId: 'campaign-a' })).toBe(false);
    expect(hasPermission([coordinator], 'CAMPAIGN_WAREHOUSE_VIEW', { campaignId: 'campaign-a' })).toBe(true);
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

  it('lets only the operations manager estimate and confirm SOS goods needs', () => {
    expect(ROLE_PERMISSIONS.COORDINATOR).not.toContain('NEED_ESTIMATE_CONFIRM');
    expect(ROLE_PERMISSIONS.OPERATIONS_MANAGER).toContain('NEED_ESTIMATE_CONFIRM');
    const coordinator: Grant = { role_code: 'COORDINATOR', scope_type: 'SYSTEM' };
    const manager: Grant = { role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' };
    expect(hasPermission([coordinator], 'NEED_ESTIMATE_CONFIRM', { campaignId: 'campaign-a' })).toBe(false);
    expect(hasPermission([manager], 'NEED_ESTIMATE_CONFIRM', { campaignId: 'campaign-a' })).toBe(true);
    expect(hasPermission([coordinator], 'NEED_MANAGE', { campaignId: 'campaign-a' })).toBe(true);
  });

  it('keeps need norm management with the system-scoped operations manager only', () => {
    expect(ROLE_PERMISSIONS.OPERATIONS_MANAGER).toContain('NEED_NORM_MANAGE');
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      if (role === 'OPERATIONS_MANAGER') continue;
      expect(ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS]).not.toContain('NEED_NORM_MANAGE');
    }
    const campaign: Grant = { role_code: 'OPERATIONS_MANAGER', scope_type: 'CAMPAIGN', campaign_id: 'campaign-a' };
    const system: Grant = { role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' };
    expect(hasPermission([system], 'NEED_NORM_MANAGE', { systemAction: 'NEED_NORM_MANAGE' })).toBe(true);
    expect(hasPermission([campaign], 'NEED_NORM_MANAGE', { systemAction: 'NEED_NORM_MANAGE' })).toBe(false);
  });

  it('keeps supply-gap warnings and their management with the operations manager only', () => {
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      if (role === 'OPERATIONS_MANAGER') continue;
      expect(ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS]).not.toContain('SUPPLY_GAP_VIEW');
      expect(ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS]).not.toContain('SUPPLY_GAP_MANAGE');
    }
    expect(ROLE_PERMISSIONS.OPERATIONS_MANAGER).toContain('SUPPLY_GAP_VIEW');
    expect(ROLE_PERMISSIONS.OPERATIONS_MANAGER).toContain('SUPPLY_GAP_MANAGE');
    const coordinator: Grant = { role_code: 'COORDINATOR', scope_type: 'SYSTEM' };
    expect(hasPermission([coordinator], 'SUPPLY_GAP_VIEW', { campaignId: null })).toBe(false);
    expect(hasPermission([coordinator], 'SUPPLY_GAP_MANAGE', { campaignId: null })).toBe(false);
    const campaignManager: Grant = { role_code: 'OPERATIONS_MANAGER', scope_type: 'CAMPAIGN', campaign_id: 'campaign-a' };
    expect(hasPermission([campaignManager], 'SUPPLY_GAP_MANAGE', { campaignId: null })).toBe(false);
    const system: Grant = { role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' };
    expect(hasPermission([system], 'SUPPLY_GAP_MANAGE', { campaignId: null })).toBe(true);
  });

  it('lets only the operations manager create, reserve and cancel pickup tickets; coordinators and reviewers may view them', () => {
    expect(ROLE_PERMISSIONS.OPERATIONS_MANAGER).toContain('PICKUP_TICKET_MANAGE');
    expect(ROLE_PERMISSIONS.COORDINATOR).not.toContain('PICKUP_TICKET_MANAGE');
    expect(ROLE_PERMISSIONS.COORDINATOR).toContain('PICKUP_TICKET_VIEW');
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      if (role === 'OPERATIONS_MANAGER') continue;
      expect(ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS]).not.toContain('PICKUP_TICKET_MANAGE');
      // COORDINATOR and REVIEWER may read tickets (the reviewer needs it for the close-out review); nobody else may.
      if (role === 'COORDINATOR' || role === 'REVIEWER') continue;
      expect(ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS]).not.toContain('PICKUP_TICKET_VIEW');
    }
    const coordinator: Grant = { role_code: 'COORDINATOR', scope_type: 'SYSTEM' };
    expect(hasPermission([coordinator], 'PICKUP_TICKET_MANAGE', { campaignId: null })).toBe(false);
    expect(hasPermission([coordinator], 'PICKUP_TICKET_VIEW', { campaignId: null })).toBe(true);
  });

  it('keeps team setup and skills with ADMIN; coordinators read team readiness only', () => {
    expect(ROLE_PERMISSIONS.ADMIN).toContain('TEAM_MANAGE_ANY');
    expect(ROLE_PERMISSIONS.COORDINATOR).not.toContain('TEAM_MANAGE_ANY');
    expect(ROLE_PERMISSIONS.COORDINATOR).toContain('TEAM_READ');
  });

  it('keeps stock adjustment request and review with the operations manager; reviewers do not adjust stock', () => {
    expect(ROLE_PERMISSIONS.OPERATIONS_MANAGER).toContain('STOCK_ADJUST_REQUEST');
    expect(ROLE_PERMISSIONS.OPERATIONS_MANAGER).toContain('ADJUSTMENT_REVIEW');
    expect(ROLE_PERMISSIONS.REVIEWER).not.toContain('ADJUSTMENT_REVIEW');
    expect(ROLE_PERMISSIONS.REVIEWER).not.toContain('STOCK_ADJUST_REQUEST');
  });

  it('splits pickup close-out submit and review: submit for coordinators and managers, review for managers and reviewers only', () => {
    for (const role of ['COORDINATOR', 'OPERATIONS_MANAGER'] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain('PICKUP_CLOSEOUT_SUBMIT');
    }
    for (const role of ['OPERATIONS_MANAGER', 'REVIEWER'] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain('PICKUP_CLOSEOUT_REVIEW');
    }
    expect(ROLE_PERMISSIONS.COORDINATOR).not.toContain('PICKUP_CLOSEOUT_REVIEW');
    expect(ROLE_PERMISSIONS.VOLUNTEER).not.toContain('PICKUP_CLOSEOUT_SUBMIT');
    expect(ROLE_PERMISSIONS.REVIEWER).not.toContain('PICKUP_CLOSEOUT_SUBMIT');
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain('PICKUP_CLOSEOUT_REVIEW');
  });
});
