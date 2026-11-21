import { jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import { lockDistributionAssets } from '../src/distributions/distribution-assets.helpers';

const distribution = {
  warehouse_id: 'warehouse-1',
};

function assetManager(inactiveWarehouse = false) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('FROM warehouse')) return [{ status: inactiveWarehouse ? 'INACTIVE' : 'ACTIVE' }];
    return [];
  });
  return { manager: { query } as unknown as EntityManager, query };
}

describe('lockDistributionAssets', () => {
  it('locks the warehouse while dispatch validates its current status', async () => {
    const { manager, query } = assetManager();

    await lockDistributionAssets(manager, distribution);

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([expect.stringMatching(/FROM warehouse .*FOR SHARE/u)]);
  });

  it('rejects a warehouse that became inactive before dispatch acquired its lock', async () => {
    const { manager } = assetManager(true);

    await expect(lockDistributionAssets(manager, distribution)).rejects.toMatchObject({ code: 'STATE_TRANSITION_INVALID' });
  });
});
