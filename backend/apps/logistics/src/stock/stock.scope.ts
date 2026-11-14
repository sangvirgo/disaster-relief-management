import { hasPermission, Grant, Permission } from '@c48/identity-contracts/permissions';
import { AppError } from '@c48/technical/errors/errors';

/** Warehouses and stock are SYSTEM resources; a campaign-attached operation (for example a distribution) passes its campaign. */
export interface WarehouseScope {
  campaign_id?: string | null;
}

export function hasWarehouseScope(grants: readonly Grant[], scope: WarehouseScope = {}): boolean {
  const campaignId = scope.campaign_id ?? null;
  return grants.some((grant) => grant.scope_type === 'SYSTEM' || (campaignId !== null && grant.campaign_id === campaignId));
}

export function requireWarehousePermission(
  grants: readonly Grant[],
  permission: Permission,
  scope: WarehouseScope = {},
): void {
  if (!hasPermission(grants, permission, { campaignId: scope.campaign_id ?? null })) {
    throw new AppError('FORBIDDEN', { status: 403 });
  }
}

export function stockWarehouseScopeSql(grants: readonly Grant[], _values: unknown[], _warehouseAlias = 'w'): string {
  if (!hasWarehouseScope(grants)) throw new AppError('FORBIDDEN', { status: 403 });
  return 'TRUE';
}
