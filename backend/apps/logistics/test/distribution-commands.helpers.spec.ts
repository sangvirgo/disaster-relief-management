import { jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import { activeItemScales, lockCommitmentContexts } from '../src/distributions/distribution-commands.helpers';

const commitmentId = '11111111-1111-4111-8111-111111111111';
const reliefNeedId = '22222222-2222-4222-8222-222222222222';
const cycleId = '33333333-3333-4333-8333-333333333333';
const itemId = '44444444-4444-4444-8444-444444444444';

function managerFor(overrides: Partial<Record<string, unknown>> = {}) {
  const context = {
    id: commitmentId,
    relief_need_id: reliefNeedId,
    cycle_id: cycleId,
    item_id: itemId,
    warehouse_id: 'warehouse-1',
    organization_id: 'organization-1',
    cycle_state: 'OPEN',
    need_status: 'OPEN',
    delivery_target_kind: 'RELIEF_POINT',
    designated_point_id: 'point-designated',
    quantity: '5.00',
    released_quantity: '0.00',
    issued_quantity: '0.00',
    unit_scale: 2,
    ...overrides,
  };
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('cm.item_id')) return [context];
    if (sql.includes('FROM commitment cm JOIN relief_need')) {
      return [{ id: commitmentId, relief_need_id: reliefNeedId, cycle_id: cycleId }];
    }
    return [];
  });
  return { manager: { query } as unknown as EntityManager, query };
}

const line = { item_id: itemId, commitment_id: commitmentId, quantity: '5.00' };

describe('lockCommitmentContexts', () => {
  it('derives the delivery target from the designated relief point column', async () => {
    const { manager, query } = managerFor();

    await lockCommitmentContexts(manager, [line], 'warehouse-1', 'organization-1', 'REQUEST_AID', 'point-designated');

    const contextQuery = query.mock.calls.find(([sql]) => String(sql).includes('cm.item_id'))?.[0];
    expect(contextQuery).toContain("CASE WHEN n.designated_point_id IS NULL THEN 'FINAL_RECIPIENT' ELSE 'RELIEF_POINT' END AS delivery_target_kind");
    expect(contextQuery).not.toContain('n.delivery_target_kind');
  });

  it('rejects a point-target commitment when the distribution uses another point', async () => {
    const { manager } = managerFor();

    await expect(lockCommitmentContexts(
      manager, [line], 'warehouse-1', 'organization-1', 'REQUEST_AID', 'point-other',
    )).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('maps a dispatch that exceeds the current reservation to INSUFFICIENT_STOCK', async () => {
    const { manager } = managerFor({ quantity: '5.00', designated_point_id: null, delivery_target_kind: 'FINAL_RECIPIENT' });

    await expect(lockCommitmentContexts(
      manager, [{ ...line, quantity: '6.00' }], 'warehouse-1', 'organization-1', 'REQUEST_AID', null, 'DISPATCH',
    )).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
  });

  it('rejects issuing a commitment after its cycle is frozen', async () => {
    const { manager } = managerFor({ cycle_state: 'FROZEN' });

    await expect(lockCommitmentContexts(
      manager, [line], 'warehouse-1', 'organization-1', 'REQUEST_AID', 'point-designated', 'DISPATCH',
    )).rejects.toMatchObject({ code: 'CYCLE_FROZEN' });
  });

  it('rejects preparing a request-linked distribution after its cycle is frozen', async () => {
    const { manager } = managerFor({ cycle_state: 'FROZEN' });

    await expect(lockCommitmentContexts(
      manager, [line], 'warehouse-1', 'organization-1', 'REQUEST_AID', 'point-designated', 'PREPARATION',
    )).rejects.toMatchObject({ code: 'CYCLE_FROZEN' });
  });
});

describe('activeItemScales', () => {
  it('locks active catalog items against concurrent deactivation', async () => {
    const query = jest.fn().mockResolvedValue([{ id: itemId, status: 'ACTIVE', unit_scale: 2 }]);

    await activeItemScales({ query } as unknown as EntityManager, [{ item_id: itemId, quantity: '1.00' }]);

    expect(query.mock.calls[0]?.[0]).toContain('FOR SHARE OF i');
  });
});
