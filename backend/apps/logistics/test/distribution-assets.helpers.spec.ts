import { jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import { lockDistributionAssets } from '../src/distributions/distribution-assets.helpers';

const distribution = {
  warehouse_id: 'warehouse-1',
  organization_id: 'organization-1',
  warehouse_region_code: 'REGION_1',
  relief_point_id: 'point-1',
  vehicle_id: 'vehicle-1',
};

function assetManager(inactiveAsset?: 'warehouse' | 'relief_point' | 'vehicle') {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('FROM warehouse')) {
      return [{ organization_id: 'organization-1', region_code: 'REGION_1', status: inactiveAsset === 'warehouse' ? 'INACTIVE' : 'ACTIVE' }];
    }
    if (sql.includes('FROM relief_point')) {
      return [{ organization_id: 'organization-1', status: inactiveAsset === 'relief_point' ? 'INACTIVE' : 'ACTIVE' }];
    }
    return [{ organization_id: 'organization-1', status: inactiveAsset === 'vehicle' ? 'INACTIVE' : 'ACTIVE' }];
  });
  return { manager: { query } as unknown as EntityManager, query };
}

describe('lockDistributionAssets', () => {
  it('locks each referenced asset while dispatch validates current status', async () => {
    const { manager, query } = assetManager();

    await lockDistributionAssets(manager, distribution);

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      expect.stringMatching(/FROM warehouse .*FOR SHARE/u),
      expect.stringMatching(/FROM relief_point .*FOR SHARE/u),
      expect.stringMatching(/FROM vehicle .*FOR SHARE/u),
    ]);
  });

  it('rejects a relief point that became inactive before dispatch acquired its lock', async () => {
    const { manager } = assetManager('relief_point');

    await expect(lockDistributionAssets(manager, distribution)).rejects.toMatchObject({ code: 'POINT_INACTIVE' });
  });
});
