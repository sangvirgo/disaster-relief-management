import { jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import { loadDispatchLines } from '../src/distributions/distribution-stock.helpers';

const distributionId = '11111111-1111-4111-8111-111111111111';
const lineId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';

describe('loadDispatchLines', () => {
  it('normalizes fixed precision database quantities to the item unit scale', async () => {
    const query = jest.fn().mockResolvedValue([{
      id: lineId,
      item_id: itemId,
      commitment_id: null,
      quantity: '5.000',
      unit_scale: 2,
    }]);

    const lines = await loadDispatchLines({ query } as unknown as EntityManager, distributionId);

    expect(query.mock.calls[0]?.[0]).toContain('u.scale AS unit_scale');
    expect(lines).toEqual([{ id: lineId, item_id: itemId, commitment_id: null, quantity: '5.00' }]);
  });
});
