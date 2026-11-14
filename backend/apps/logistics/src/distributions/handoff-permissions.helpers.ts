import { AppError } from '@c48/technical/errors/errors';
import { hasPermission } from '@c48/identity-contracts/permissions';
import type { Grant, Permission } from '@c48/identity-contracts/permissions';
import { hasWarehouseScope, requireWarehousePermission } from '../stock/stock.scope';
import type { DistributionContext } from './distributions.read';
import type { DistributionHandoffKind } from './distributions.helpers';

export type HandoffPermission = 'HANDOFF_RECORD' | 'LOSS_APPROVE' | 'RETURN';
type DistributionScope = Pick<DistributionContext, 'organization_id'>;

export function requireHandoffPermission(
  grants: readonly Grant[],
  permission: HandoffPermission,
  distribution: DistributionScope,
): void {
  const { organization_id: organizationId } = distribution;
  if (!hasWarehouseScope(grants, organizationId)) throw new AppError('NOT_FOUND', { status: 404 });

  if (permission === 'RETURN') {
    const target = { organizationId };
    if (!hasPermission(grants, 'DONATION_INTAKE', target) && !hasPermission(grants, 'DISTRIBUTION_DISPATCH', target)) {
      throw new AppError('FORBIDDEN', { status: 403 });
    }
    return;
  }

  requireWarehousePermission(grants, permission, organizationId);
}

export function requireHandoffReadPermission(
  grants: readonly Grant[],
  handoffKind: DistributionHandoffKind,
  distribution: DistributionScope,
): void {
  const { organization_id: organizationId } = distribution;
  if (!hasWarehouseScope(grants, organizationId)) throw new AppError('NOT_FOUND', { status: 404 });

  const target = { organizationId };
  const required: readonly Permission[] = handoffKind === 'RETURN'
    ? ['DONATION_INTAKE', 'DISTRIBUTION_DISPATCH']
    : handoffKind === 'LOSS'
      ? ['HANDOFF_RECORD', 'LOSS_APPROVE']
      : ['HANDOFF_RECORD'];
  if (!required.some((permission) => hasPermission(grants, permission, target))) {
    throw new AppError('FORBIDDEN', { status: 403 });
  }
}
