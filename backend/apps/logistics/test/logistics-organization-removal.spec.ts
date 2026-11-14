import { describe, expect, it, jest } from '@jest/globals';
import type { Grant } from '@c48/identity-contracts/permissions';
import { RemoveOrganizationLogistics1794787200000 } from '../src/database/migrations/RemoveOrganizationLogistics1794787200000';
import { driveScopeSql, requireDrivePermission } from '../src/drives/drives.helpers';

const campaignOne = '11111111-1111-4111-8111-111111111111';
const campaignTwo = '22222222-2222-4222-8222-222222222222';

describe('RemoveOrganizationLogistics migration', () => {
  it('removes organization attribution from the seven Logistics tables while retaining campaign indexes and accounting guards', async () => {
    const query = jest.fn(async (_sql: string) => []);
    await new RemoveOrganizationLogistics1794787200000().up({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));

    for (const table of ['warehouse', 'relief_point', 'vehicle', 'donation_drive', 'donation_delivery', 'fulfillment_cycle', 'distribution']) {
      expect(statements).toContain(`ALTER TABLE ${table} DROP COLUMN organization_id`);
    }
    expect(statements).toContain('DROP TRIGGER IF EXISTS relief_need_point_org_guard ON relief_need');
    expect(statements).toContain('DROP TRIGGER IF EXISTS commitment_warehouse_org_guard ON commitment');
    expect(statements.some((sql) => sql.includes('CREATE UNIQUE INDEX vehicle_identifier_uq ON vehicle (lower(identifier))'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE INDEX distribution_campaign_created_idx'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TABLE organization_snapshot'))).toBe(false);
    expect(statements.some((sql) => sql.includes('DROP FUNCTION IF EXISTS apply_stock_movement'))).toBe(false);
    expect(statements.some((sql) => sql.includes('DROP TRIGGER IF EXISTS receipt_review_independence'))).toBe(false);
    expect(statements.some((sql) => sql.includes('DROP TRIGGER IF EXISTS cycle_intent_guard'))).toBe(false);
  });

  it('re-adds nullable attribution columns and restores the legacy composite structures on rollback', async () => {
    const query = jest.fn(async (_sql: string) => []);
    await new RemoveOrganizationLogistics1794787200000().down({ query } as never);
    const statements = query.mock.calls.map(([sql]) => String(sql));

    for (const table of ['warehouse', 'relief_point', 'vehicle', 'donation_drive', 'donation_delivery', 'fulfillment_cycle', 'distribution']) {
      expect(statements).toContain(`ALTER TABLE ${table} ADD COLUMN organization_id uuid`);
    }
    expect(statements.some((sql) => sql.includes('ADD CONSTRAINT warehouse_id_organization_id_key UNIQUE (id,organization_id)'))).toBe(true);
    expect(statements.some((sql) => sql.includes('ADD CONSTRAINT distribution_warehouse_id_organization_id_fkey'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TRIGGER relief_need_point_org_guard'))).toBe(true);
    expect(statements.some((sql) => sql.includes('CREATE TRIGGER commitment_warehouse_org_guard'))).toBe(true);
    expect(statements.some((sql) => sql.includes('organization_id uuid NOT NULL'))).toBe(false);
  });
});

describe('donation drive campaign scope', () => {
  const campaignGrant: Grant = { role_code: 'OPERATIONS_MANAGER', scope_type: 'CAMPAIGN', campaign_id: campaignOne };
  const systemGrant: Grant = { role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM', campaign_id: null };
  const session = (grants: Grant[]) => ({ userId: 'user-1', grants } as never);

  it('allows a campaign grant only for its campaign in object checks and list predicates', () => {
    expect(() => requireDrivePermission(session([campaignGrant]), 'DONATION_DRIVE_MANAGE', { campaign_id: campaignOne })).not.toThrow();
    expect(() => requireDrivePermission(session([campaignGrant]), 'DONATION_DRIVE_MANAGE', { campaign_id: campaignTwo }))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));

    const values: unknown[] = [];
    expect(driveScopeSql([campaignGrant], values, ['DONATION_DRIVE_MANAGE'], 'd')).toBe('(d.campaign_id=$1)');
    expect(values).toEqual([campaignOne]);
  });

  it('keeps system grants global and prevents campaign grants from acting on unscoped drives', () => {
    const values: unknown[] = [];
    expect(driveScopeSql([systemGrant], values, ['DONATION_DRIVE_MANAGE'], 'd')).toBe('TRUE');
    expect(values).toEqual([]);
    expect(() => requireDrivePermission(session([campaignGrant]), 'DONATION_DRIVE_MANAGE', { campaign_id: null }))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
  });
});
