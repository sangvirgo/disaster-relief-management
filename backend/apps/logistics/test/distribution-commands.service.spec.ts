import { jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import { DistributionCommandsService } from '../src/distributions/distribution-commands.service';
import type { DistributionContext } from '../src/distributions/distributions.read';

const itemId = '11111111-1111-4111-8111-111111111111';
const commitmentId = '22222222-2222-4222-8222-222222222222';
const needId = '33333333-3333-4333-8333-333333333333';
const cycleId = '44444444-4444-4444-8444-444444444444';

describe('DistributionCommandsService line validation lock order', () => {
  it('locks request cycle and commitment before locking catalog items', async () => {
    const context = {
      id: commitmentId,
      relief_need_id: needId,
      cycle_id: cycleId,
      item_id: itemId,
      warehouse_id: 'warehouse-1',
      organization_id: 'organization-1',
      cycle_state: 'OPEN',
      need_status: 'OPEN',
      delivery_target_kind: 'FINAL_RECIPIENT',
      designated_point_id: null,
      quantity: '1.00',
      released_quantity: '0.00',
      issued_quantity: '0.00',
      unit_scale: 2,
    };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('cm.item_id')) return [context];
      if (sql.includes('SELECT cm.id,cm.relief_need_id,n.cycle_id')) {
        return [{ id: commitmentId, relief_need_id: needId, cycle_id: cycleId }];
      }
      if (sql.includes('FROM item i JOIN unit')) return [{ id: itemId, status: 'ACTIVE', unit_scale: 2 }];
      return [];
    });
    const service = Object.create(DistributionCommandsService.prototype) as unknown as {
      validateLines: (manager: EntityManager, distribution: DistributionContext, lines: { item_id: string; commitment_id: string; quantity: string }[]) => Promise<unknown>;
    };

    await service.validateLines({ query } as unknown as EntityManager, {
      purpose: 'REQUEST_AID',
      warehouse_id: 'warehouse-1',
      organization_id: 'organization-1',
      relief_point_id: null,
    } as DistributionContext, [{ item_id: itemId, commitment_id: commitmentId, quantity: '1.00' }]);

    const sqlCalls = query.mock.calls.map(([sql]) => String(sql));
    const cycleLock = sqlCalls.findIndex((sql) => sql.includes('FROM fulfillment_cycle') && sql.includes('FOR UPDATE'));
    const itemLock = sqlCalls.findIndex((sql) => sql.includes('FOR SHARE OF i'));
    expect(cycleLock).toBeGreaterThanOrEqual(0);
    expect(itemLock).toBeGreaterThan(cycleLock);
  });
});
