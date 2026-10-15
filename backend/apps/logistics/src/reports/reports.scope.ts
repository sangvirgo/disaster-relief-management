import { AppError } from '../../../../packages/technical/src/errors/errors';
import { hasPermission, ROLE_PERMISSIONS } from '../../../../packages/technical/src/security/permissions';
import type { Grant, Permission, ScopeType } from '../../../../packages/technical/src/security/permissions';

type ReportScope = Extract<ScopeType, 'SYSTEM' | 'ORGANIZATION' | 'REGION' | 'CAMPAIGN'>;

function permissionMatches(grant: Grant, permissions: readonly Permission[]): boolean {
  const target = grant.scope_type === 'SYSTEM'
    ? (permission: Permission) => ({ systemAction: permission })
    : grant.scope_type === 'REGION'
      ? (permission: Permission) => ({ organizationId: grant.organization_id!, regionCode: grant.region_code!, systemAction: permission })
      : grant.scope_type === 'CAMPAIGN'
        ? (permission: Permission) => ({ organizationId: grant.organization_id!, campaignId: grant.campaign_id!, systemAction: permission })
        : (permission: Permission) => ({ organizationId: grant.organization_id!, systemAction: permission });
  const rolePermissions: readonly string[] = ROLE_PERMISSIONS[grant.role_code];
  return permissions.some((permission) => rolePermissions.includes(permission) && hasPermission([grant], permission, target(permission)));
}

export function reportScopeSql(
  grants: readonly Grant[],
  permissions: readonly Permission[],
  values: unknown[],
  alias: string,
  allowedScopes: readonly ReportScope[] = ['SYSTEM', 'ORGANIZATION', 'REGION', 'CAMPAIGN'],
): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(alias)) throw new TypeError('Invalid report scope alias');
  const branches = new Set<string>();

  for (const grant of grants) {
    if (!allowedScopes.includes(grant.scope_type as ReportScope) || !permissionMatches(grant, permissions)) continue;
    if (grant.scope_type === 'SYSTEM' && grant.organization_id === null && !grant.region_code && !grant.campaign_id) {
      branches.add('TRUE');
    } else if (grant.scope_type === 'ORGANIZATION' && grant.organization_id && !grant.region_code && !grant.campaign_id) {
      values.push(grant.organization_id);
      branches.add(`(${alias}.organization_id=$${values.length})`);
    } else if (grant.scope_type === 'REGION' && grant.organization_id && grant.region_code && !grant.campaign_id) {
      values.push(grant.organization_id, grant.region_code);
      branches.add(`(${alias}.organization_id=$${values.length - 1} AND ${alias}.region_code=$${values.length})`);
    } else if (grant.scope_type === 'CAMPAIGN' && grant.organization_id && grant.campaign_id && !grant.region_code) {
      values.push(grant.organization_id, grant.campaign_id);
      branches.add(`(${alias}.organization_id=$${values.length - 1} AND ${alias}.campaign_id=$${values.length})`);
    }
  }

  if (branches.size === 0) throw new AppError('FORBIDDEN', { status: 403 });
  return `(${[...branches].join(' OR ')})`;
}
