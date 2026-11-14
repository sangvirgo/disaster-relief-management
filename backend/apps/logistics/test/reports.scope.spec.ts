import { AppError } from '@c48/technical/errors/errors';
import type { Grant, Permission } from '@c48/identity-contracts/permissions';
import { reportScopeSql } from '../src/reports/reports.scope';

const reportPermissions: Permission[] = ['REPORT_READ'];

describe('reportScopeSql', () => {
  it('allows warehouse reports to SYSTEM grants', () => {
    const grants: Grant[] = [
      { role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' },
    ];
    const values: unknown[] = [];

    const scope = reportScopeSql(grants, reportPermissions, values, 'w', ['SYSTEM']);

    expect(scope).toBe('(TRUE)');
    expect(values).toEqual([]);
  });

  it('keeps campaign grants on campaign-owned report rows', () => {
    const grants: Grant[] = [
      { role_code: 'CAMPAIGN_MANAGER', scope_type: 'CAMPAIGN', campaign_id: '33333333-3333-4333-8333-333333333333' },
    ];
    const values: unknown[] = [];

    const scope = reportScopeSql(grants, reportPermissions, values, 'c');

    expect(scope).toBe('((c.campaign_id=$1))');
    expect(values).toEqual(['33333333-3333-4333-8333-333333333333']);
  });

  it('supports system-scoped permissions and rejects grants without report access', () => {
    const systemValues: unknown[] = [];
    expect(reportScopeSql([
      { role_code: 'ADMIN', scope_type: 'SYSTEM' },
    ], reportPermissions, systemValues, 'c')).toBe('(TRUE)');

    expect(() => reportScopeSql([], reportPermissions, [], 'c')).toThrow(AppError);
  });

  it('accepts either documented permission for reconciliation', () => {
    const grants: Grant[] = [
      { role_code: 'REVIEWER', scope_type: 'SYSTEM' },
    ];
    const values: unknown[] = [];

    const scope = reportScopeSql(grants, ['REPORT_READ', 'DISTRIBUTION_REVIEW'], values, 'w');

    expect(scope).toBe('(TRUE)');
    expect(values).toEqual([]);
  });
});
