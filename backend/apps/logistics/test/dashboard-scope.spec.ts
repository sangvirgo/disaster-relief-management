import { scopeFor } from '../src/reports/operations-dashboard.service';
import { classifyStock } from '../src/reports/drive-suggestions.service';
import type { Grant } from '@c48/identity-contracts/permissions';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const grant = (role_code: Grant['role_code'], scope_type: Grant['scope_type'], organization_id: string | null): Grant =>
  ({ role_code, scope_type, organization_id });

describe('operations dashboard scope', () => {
  it('limits staff to the organizations of grants that carry the permission', () => {
    const grants = [grant('INTAKE_STAFF', 'ORGANIZATION', ORG_A), grant('DISTRIBUTION_STAFF', 'ORGANIZATION', ORG_B)];
    expect(scopeFor(grants, ['DONATION_INTAKE'])).toEqual([ORG_A]);
    expect(scopeFor(grants, ['HANDOFF_RECORD'])).toEqual([ORG_B]);
    expect(scopeFor(grants, ['DISTRIBUTION_PREPARE'])?.sort()).toEqual([ORG_A, ORG_B]);
  });

  it('grants no access without a matching permission', () => {
    expect(scopeFor([grant('CITIZEN', 'SYSTEM', null)], ['REPORT_READ'])).toEqual([]);
    expect(scopeFor([grant('INTAKE_STAFF', 'ORGANIZATION', ORG_A)], ['NEED_MANAGE'])).toEqual([]);
  });

  it('gives only a system administrator an unrestricted scope', () => {
    expect(scopeFor([grant('ADMIN', 'SYSTEM', null)], ['REPORT_READ'])).toBeNull();
    expect(scopeFor([grant('ADMIN', 'SYSTEM', null)], ['NEED_MANAGE'])).toEqual([]);
    expect(scopeFor([grant('OPERATIONS_MANAGER', 'SYSTEM', null)], ['REPORT_READ'])).toEqual([]);
  });
});

describe('stock classification for donation drive advice', () => {
  it.each([
    [0, 0, 50, 'STOCK_OUT'], [-3, 0, 50, 'STOCK_OUT'],
    [40, 100, 50, 'STOCK_SHORTFALL'], [200, 100, 50, null],
    [50, 0, 50, 'STOCK_LOW'], [51, 0, 50, null],
  ])('available %d, need %d, threshold %d -> %s', (available, need, threshold, expected) => {
    expect(classifyStock(available, need, threshold)).toBe(expected);
  });
});
