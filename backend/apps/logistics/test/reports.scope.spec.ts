import { AppError } from '../../../packages/technical/src/errors/errors';
import type { Grant, Permission } from '../../../packages/identity-contracts/src/permissions';
import { reportScopeSql } from '../src/reports/reports.scope';

const reportPermissions: Permission[] = ['REPORT_READ'];

describe('reportScopeSql', () => {
  it('limits warehouse reports to organization and region grants', () => {
    const grants: Grant[] = [
      { role_code: 'OPERATIONS_MANAGER', scope_type: 'ORGANIZATION', organization_id: 'org-1' },
      { role_code: 'COORDINATOR', scope_type: 'REGION', organization_id: 'org-2', region_code: 'R2' },
      { role_code: 'CAMPAIGN_MANAGER', scope_type: 'CAMPAIGN', organization_id: 'org-3', campaign_id: 'campaign-3' },
    ];
    const values: unknown[] = [];

    const scope = reportScopeSql(grants, reportPermissions, values, 'w', ['ORGANIZATION', 'REGION', 'SYSTEM']);

    expect(scope).toBe('((w.organization_id=$1) OR (w.organization_id=$2 AND w.region_code=$3))');
    expect(values).toEqual(['org-1', 'org-2', 'R2']);
  });

  it('keeps campaign grants on campaign-owned report rows', () => {
    const grants: Grant[] = [
      { role_code: 'CAMPAIGN_MANAGER', scope_type: 'CAMPAIGN', organization_id: 'org-3', campaign_id: 'campaign-3' },
    ];
    const values: unknown[] = [];

    const scope = reportScopeSql(grants, reportPermissions, values, 'c');

    expect(scope).toBe('((c.organization_id=$1 AND c.campaign_id=$2))');
    expect(values).toEqual(['org-3', 'campaign-3']);
  });

  it('supports system-scoped permissions and rejects grants without report access', () => {
    const systemValues: unknown[] = [];
    expect(reportScopeSql([
      { role_code: 'ADMIN', scope_type: 'SYSTEM', organization_id: null },
    ], reportPermissions, systemValues, 'c')).toBe('(TRUE)');

    expect(() => reportScopeSql([], reportPermissions, [], 'c')).toThrow(AppError);
  });

  it('accepts either documented permission for reconciliation', () => {
    const grants: Grant[] = [
      { role_code: 'REVIEWER', scope_type: 'ORGANIZATION', organization_id: 'org-review' },
    ];
    const values: unknown[] = [];

    const scope = reportScopeSql(grants, ['REPORT_READ', 'DISTRIBUTION_REVIEW'], values, 'w');

    expect(scope).toBe('((w.organization_id=$1))');
    expect(values).toEqual(['org-review']);
  });
});
