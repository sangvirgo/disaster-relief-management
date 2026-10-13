import { jest } from '@jest/globals';
import type { DataSource, EntityManager } from 'typeorm';
import type { Grant } from '../../../packages/technical/src/security/permissions';
import type { DistributionContext } from '../src/distributions/distributions.read';
import type { CreateDistributionDto } from '../src/distributions/distributions.dto';

const itemId = '44444444-4444-4444-8444-444444444444';
const cancelledDistribution = {
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
  purpose: 'DIRECT_DISTRIBUTION',
  status: 'CANCELLED',
  preparer_user_id: 'preparer-1',
  approver_user_id: 'approver-1',
  approved_version: 1,
  dispatch_actor_user_id: null,
  dispatched_at: null,
  reconciled_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  version: 2,
} as unknown as DistributionContext;

const manager = { query: jest.fn() } as unknown as EntityManager;

await jest.unstable_mockModule('../src/distributions/distributions.read', () => ({
  loadDistribution: jest.fn().mockResolvedValue(cancelledDistribution),
  readDistributionView: jest.fn().mockResolvedValue({ id: cancelledDistribution.id, status: 'CANCELLED' }),
}));

const { DistributionCommandsService } = await import('../src/distributions/distribution-commands.service');

describe('distribution cancellation idempotency replay', () => {
  it('allows a reviewer-only approver to replay their cancellation', async () => {
    const grants: Grant[] = [{
      role_code: 'REVIEWER',
      scope_type: 'ORGANIZATION',
      organization_id: 'organization-1',
    }];
    const session = { userId: 'approver-1', grants, identityHeaders: {} };
    const idempotency = {
      execute: jest.fn(async (_source: unknown, input: {
        replay?: (tx: EntityManager, resource: { type: string; id: string } | null) => Promise<Record<string, unknown>>;
      }) => ({
        status: 200,
        value: await input.replay?.(manager, { type: 'distribution', id: cancelledDistribution.id }),
        replay: true,
      })),
    };
    const sessions = { require: jest.fn().mockResolvedValue(session) };
    const service = new DistributionCommandsService(
      {} as DataSource,
      idempotency as never,
      sessions as never,
      {} as never,
    );

    const result = await service.cancel(
      cancelledDistribution.id,
      { expected_version: 1 },
      { idempotencyKey: 'cancel-key' } as never,
    );

    expect(result).toMatchObject({ replay: true, value: { id: cancelledDistribution.id, status: 'CANCELLED' } });
  });

  it('replays a created distribution if its campaign and warehouse become inactive', async () => {
    const grants: Grant[] = [{
      role_code: 'OPERATIONS_MANAGER',
      scope_type: 'ORGANIZATION',
      organization_id: 'organization-1',
    }];
    const session = { userId: 'preparer-1', grants, identityHeaders: {} };
    const dataSource = {
      query: jest.fn().mockResolvedValue([{
        id: 'warehouse-1', organization_id: 'organization-1', region_code: 'REGION_1', status: 'INACTIVE',
      }]),
    };
    const idempotency = {
      execute: jest.fn(async (_source: unknown, input: {
        replay?: (tx: EntityManager, resource: { type: string; id: string } | null) => Promise<Record<string, unknown>>;
      }) => ({
        status: 201,
        value: await input.replay?.(manager, { type: 'distribution', id: cancelledDistribution.id }),
        replay: true,
      })),
    };
    const sessions = { require: jest.fn().mockResolvedValue(session) };
    const campaigns = { getCampaign: jest.fn().mockResolvedValue({ organization_id: 'organization-1', status: 'PAUSED' }) };
    const service = new DistributionCommandsService(
      dataSource as unknown as DataSource,
      idempotency as never,
      sessions as never,
      campaigns as never,
    );
    const dto: CreateDistributionDto = {
      warehouse_id: 'warehouse-1',
      campaign_id: 'campaign-1',
      purpose: 'CAMPAIGN_DISTRIBUTION',
      lines: [{ item_id: itemId, quantity: '1.00' }],
    };

    const result = await service.create(dto, { idempotencyKey: 'create-key' } as never);

    expect(result).toMatchObject({ replay: true, value: { id: cancelledDistribution.id, status: 'CANCELLED' } });
    expect(campaigns.getCampaign).toHaveBeenCalledWith('campaign-1');
  });
});
