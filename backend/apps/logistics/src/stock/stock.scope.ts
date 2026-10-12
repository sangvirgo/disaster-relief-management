import { hasPermission, Grant, Permission } from '../../../../packages/technical/src/security/permissions';
import { AppError } from '../../../../packages/technical/src/errors/errors';

export function hasWarehouseScope(grants: readonly Grant[], organizationId: string, regionCode: string): boolean {
  return grants.some((grant) => {
    if (grant.scope_type === 'ORGANIZATION' && !grant.region_code && !grant.campaign_id) {
      return grant.organization_id === organizationId;
    }
    return grant.scope_type === 'REGION' && grant.organization_id === organizationId &&
      grant.region_code === regionCode && !grant.campaign_id;
  });
}

export function requireWarehousePermission(
  grants: readonly Grant[],
  permission: Permission,
  organizationId: string,
  regionCode: string,
): void {
  if (!hasPermission(grants, permission, { organizationId, regionCode })) {
    throw new AppError('FORBIDDEN', { status: 403 });
  }
}

export function stockWarehouseScopeSql(grants: readonly Grant[], values: unknown[], warehouseAlias = 'w'): string {
  const branches: string[] = [];
  for (const grant of grants) {
    if (!grant.organization_id) continue;
    if (grant.scope_type === 'ORGANIZATION' && !grant.region_code && !grant.campaign_id) {
      values.push(grant.organization_id);
      branches.push(`${warehouseAlias}.organization_id=$${values.length}`);
    } else if (grant.scope_type === 'REGION' && grant.region_code && !grant.campaign_id) {
      values.push(grant.organization_id, grant.region_code);
      branches.push(`(${warehouseAlias}.organization_id=$${values.length - 1} AND ${warehouseAlias}.region_code=$${values.length})`);
    }
  }
  if (branches.length === 0) throw new AppError('FORBIDDEN', { status: 403 });
  return `(${branches.join(' OR ')})`;
}
