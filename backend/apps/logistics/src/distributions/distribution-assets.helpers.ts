import type { EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import type { DistributionContext } from './distributions.read';

type DistributionAssetReferences = Pick<DistributionContext, 'warehouse_id' | 'relief_point_id' | 'vehicle_id'> & {
  organization_id?: string;
};

interface LockedWarehouse {
  organization_id: string;
  region_code: string;
  status: 'ACTIVE' | 'INACTIVE';
}

interface RelatedAsset {
  organization_id: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export async function lockDistributionAssets(
  manager: Pick<EntityManager, 'query'>,
  distribution: DistributionAssetReferences,
): Promise<LockedWarehouse> {
  const warehouses = await manager.query(
    'SELECT organization_id,region_code,status FROM warehouse WHERE id=$1 FOR SHARE',
    [distribution.warehouse_id],
  ) as LockedWarehouse[];
  const warehouse = warehouses[0];
  if (!warehouse) throw new AppError('NOT_FOUND', { status: 404 });
  if (warehouse.status !== 'ACTIVE') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
  if (distribution.organization_id && warehouse.organization_id !== distribution.organization_id) {
    throw new AppError('VALIDATION_FAILED', { status: 400 });
  }

  if (distribution.relief_point_id) {
    const points = await manager.query(
      'SELECT organization_id,status FROM relief_point WHERE id=$1 FOR SHARE',
      [distribution.relief_point_id],
    ) as RelatedAsset[];
    const point = points[0];
    if (!point || point.organization_id !== warehouse.organization_id) throw new AppError('VALIDATION_FAILED', { status: 400 });
    if (point.status !== 'ACTIVE') throw new AppError('POINT_INACTIVE', { status: 409 });
  }

  if (distribution.vehicle_id) {
    const vehicles = await manager.query(
      'SELECT organization_id,status FROM vehicle WHERE id=$1 FOR SHARE',
      [distribution.vehicle_id],
    ) as RelatedAsset[];
    const vehicle = vehicles[0];
    if (!vehicle || vehicle.organization_id !== warehouse.organization_id) throw new AppError('VALIDATION_FAILED', { status: 400 });
    if (vehicle.status !== 'ACTIVE') throw new AppError('VEHICLE_INACTIVE', { status: 409 });
  }

  return warehouse;
}
