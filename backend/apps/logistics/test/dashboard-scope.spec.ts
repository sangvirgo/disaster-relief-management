import { scopeFor } from '../src/reports/operations-dashboard.service';
import { classifyStock } from '../src/reports/drive-suggestions.service';
import type { Grant } from '@c48/identity-contracts/permissions';

const grant = (role_code: Grant['role_code'], scope_type: Grant['scope_type']): Grant => ({ role_code, scope_type });

describe('operations dashboard scope', () => {
  it('returns SYSTEM scope only when a grant carries the requested permission', () => {
    expect(scopeFor([grant('INTAKE_STAFF', 'SYSTEM')], ['DONATION_INTAKE'])).toBeNull();
    expect(scopeFor([grant('DISTRIBUTION_STAFF', 'SYSTEM')], ['HANDOFF_RECORD'])).toBeNull();
    expect(scopeFor([grant('DISTRIBUTION_STAFF', 'SYSTEM')], ['DISTRIBUTION_REVIEW'])).toEqual([]);
  });

  it('grants no access without a matching permission', () => {
    expect(scopeFor([grant('CITIZEN', 'SYSTEM')], ['REPORT_READ'])).toEqual([]);
    expect(scopeFor([grant('INTAKE_STAFF', 'SYSTEM')], ['NEED_MANAGE'])).toEqual([]);
  });

  it('gives only a system administrator an unrestricted scope', () => {
    expect(scopeFor([grant('ADMIN', 'SYSTEM')], ['REPORT_READ'])).toBeNull();
    expect(scopeFor([grant('ADMIN', 'SYSTEM')], ['NEED_MANAGE'])).toEqual([]);
    expect(scopeFor([grant('OPERATIONS_MANAGER', 'SYSTEM')], ['REPORT_READ'])).toBeNull();
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
