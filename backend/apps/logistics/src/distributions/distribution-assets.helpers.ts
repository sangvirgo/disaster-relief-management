import type { EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import type { DistributionContext } from './distributions.read';

type DistributionAssetReferences = Pick<DistributionContext, 'warehouse_id'>;

interface LockedWarehouse {
  status: 'ACTIVE' | 'INACTIVE';
}

export async function lockDistributionAssets(
  manager: Pick<EntityManager, 'query'>,
  distribution: DistributionAssetReferences,
): Promise<LockedWarehouse> {
  const warehouses = await manager.query(
    'SELECT status FROM warehouse WHERE id=$1 FOR SHARE',
    [distribution.warehouse_id],
  ) as LockedWarehouse[];
  const warehouse = warehouses[0];
  if (!warehouse) throw new AppError('NOT_FOUND', { status: 404 });
  if (warehouse.status !== 'ACTIVE') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });

  return warehouse;
}
