import { jest } from '@jest/globals';
import type { DataSource, EntityManager } from 'typeorm';
import type { DistributionContext } from '../src/distributions/distributions.read';
import type { Grant } from '@c48/identity-contracts/permissions';

await jest.unstable_mockModule('../src/distributions/handoffs.read', () => ({
  readHandoffView: jest.fn().mockResolvedValue({ id: 'handoff-1' }),
}));
const { HandoffCommandsService } = await import('../src/distributions/handoff-commands.service');

const distribution = {
  id: 'distribution-1',
  warehouse_id: 'warehouse-1',
  organization_id: 'organization-1',
  warehouse_region_code: 'REGION_1',
  warehouse_status: 'ACTIVE',
  relief_point_id: null,
  relief_point_status: null,
  vehicle_id: null,
  vehicle_status: null,
  vehicle_capacity: null,
  vehicle_capacity_unit: null,
  vehicle_capacity_scale: null,
  campaign_id: null,
  purpose: 'REQUEST_AID',
  status: 'DISPATCHED',
  preparer_user_id: 'preparer-1',
  approver_user_id: 'approver-1',
  approved_version: 2,
  dispatch_actor_user_id: 'dispatcher-1',
  dispatched_at: '2026-01-01T00:00:00.000Z',
  reconciled_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  version: 3,
} as unknown as DistributionContext;

const inScopeWithoutHandoffPermission: Grant[] = [
  { role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: 'organization-1' },
];

function replayService(handoffKind: 'DIRECT_HOUSEHOLD' | 'LOSS') {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('FROM handoff_record')) return [{ distribution_id: distribution.id, handoff_kind: handoffKind }];
    if (sql.includes('FROM distribution d')) return [distribution];
    return [];
  });
  const service = new HandoffCommandsService({} as DataSource, {} as never, {} as never);
  const replay = (service as unknown as {
    replayHandoff(
      manager: EntityManager,
      resource: { type: string; id: string },
      grants: readonly Grant[],
      command: 'HANDOFF_CREATE' | 'LOSS_APPROVE',
    ): Promise<Record<string, unknown>>;
  }).replayHandoff.bind(service);
  const manager = { query } as unknown as EntityManager;
  return { manager, replay };
}

describe('handoff idempotency replay authorization', () => {
  it('rechecks HANDOFF_RECORD before returning a recorded handoff', async () => {
    const { manager, replay } = replayService('DIRECT_HOUSEHOLD');

    await expect(replay(
      manager, { type: 'handoff', id: 'handoff-1' }, inScopeWithoutHandoffPermission, 'HANDOFF_CREATE',
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rechecks LOSS_APPROVE before returning a reviewed loss', async () => {
    const { manager, replay } = replayService('LOSS');

    await expect(replay(
      manager, { type: 'handoff', id: 'handoff-1' }, inScopeWithoutHandoffPermission, 'LOSS_APPROVE',
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
