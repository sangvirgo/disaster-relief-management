import { AppError } from '@c48/technical/errors/errors';
import { hasPermission, ROLE_PERMISSIONS } from '@c48/identity-contracts/permissions';
import type { Grant, Permission, ScopeType } from '@c48/identity-contracts/permissions';

type ReportScope = ScopeType;

function permissionMatches(grant: Grant, permissions: readonly Permission[]): boolean {
  const rolePermissions: readonly string[] = ROLE_PERMISSIONS[grant.role_code];
  return permissions.some((permission) => rolePermissions.includes(permission) && hasPermission(
    [grant], permission, grant.scope_type === 'CAMPAIGN' ? { campaignId: grant.campaign_id ?? null } : { systemAction: permission },
  ));
}

export function reportScopeSql(
  grants: readonly Grant[],
  permissions: readonly Permission[],
  values: unknown[],
  alias: string,
  allowedScopes: readonly ReportScope[] = ['SYSTEM', 'CAMPAIGN'],
): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(alias)) throw new TypeError('Invalid report scope alias');
  const branches = new Set<string>();

  for (const grant of grants) {
    if (!allowedScopes.includes(grant.scope_type as ReportScope) || !permissionMatches(grant, permissions)) continue;
    if (grant.scope_type === 'SYSTEM' && !grant.campaign_id) {
      branches.add('TRUE');
    } else if (grant.scope_type === 'CAMPAIGN' && grant.campaign_id) {
      values.push(grant.campaign_id);
      branches.add(`(${alias}.campaign_id=$${values.length})`);
    }
  }

  if (branches.size === 0) throw new AppError('FORBIDDEN', { status: 403 });
  return `(${[...branches].join(' OR ')})`;
}
