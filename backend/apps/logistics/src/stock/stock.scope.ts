import { hasPermission, Grant, Permission } from '@c48/identity-contracts/permissions';
import { AppError } from '@c48/technical/errors/errors';

export function hasWarehouseScope(grants: readonly Grant[], organizationId: string): boolean {
  return grants.some((grant) => grant.scope_type === 'ORGANIZATION' && !grant.campaign_id && grant.organization_id === organizationId);
}

export function requireWarehousePermission(
  grants: readonly Grant[],
  permission: Permission,
  organizationId: string,
): void {
  if (!hasPermission(grants, permission, { organizationId })) {
    throw new AppError('FORBIDDEN', { status: 403 });
  }
}

export function stockWarehouseScopeSql(grants: readonly Grant[], values: unknown[], warehouseAlias = 'w'): string {
  const branches: string[] = [];
  for (const grant of grants) {
    if (!grant.organization_id) continue;
    if (grant.scope_type === 'ORGANIZATION' && !grant.campaign_id) {
      values.push(grant.organization_id);
      branches.push(`${warehouseAlias}.organization_id=$${values.length}`);
    }
  }
  if (branches.length === 0) throw new AppError('FORBIDDEN', { status: 403 });
  return `(${branches.join(' OR ')})`;
}
