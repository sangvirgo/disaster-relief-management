import { AppError } from '../../../../packages/technical/src/errors/errors';
import { hasPermission } from '../../../../packages/technical/src/security/permissions';
import type { Grant } from '../../../../packages/technical/src/security/permissions';
import { hasWarehouseScope, requireWarehousePermission } from '../stock/stock.scope';
import type { DistributionContext } from './distributions.read';

export type HandoffPermission = 'HANDOFF_RECORD' | 'LOSS_APPROVE' | 'RETURN';
type DistributionScope = Pick<DistributionContext, 'organization_id' | 'warehouse_region_code'>;

export function requireHandoffPermission(
  grants: readonly Grant[],
  permission: HandoffPermission,
  distribution: DistributionScope,
): void {
  const { organization_id: organizationId, warehouse_region_code: regionCode } = distribution;
  if (!hasWarehouseScope(grants, organizationId, regionCode)) throw new AppError('NOT_FOUND', { status: 404 });

  if (permission === 'RETURN') {
    const target = { organizationId, regionCode };
    if (!hasPermission(grants, 'DONATION_INTAKE', target) && !hasPermission(grants, 'DISTRIBUTION_DISPATCH', target)) {
      throw new AppError('FORBIDDEN', { status: 403 });
    }
    return;
  }

  requireWarehousePermission(grants, permission, organizationId, regionCode);
}
