import { jest } from '@jest/globals';
import type { DataSource, EntityManager } from 'typeorm';
import type { DistributionContext } from '../src/distributions/distributions.read';
import type { Grant } from '@c48/identity-contracts/permissions';

const dispatcherId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherUserId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const campaignA = '99999999-9999-4999-8999-999999999999';
const campaignB = '88888888-8888-4888-8888-888888888888';

let currentDistribution: Record<string, unknown> = {};

await jest.unstable_mockModule('../src/distributions/handoffs.read', () => ({
  readHandoffView: jest.fn().mockResolvedValue({ id: 'handoff-1' }),
}));
await jest.unstable_mockModule('../src/distributions/distributions.read', () => ({
  loadDistribution: jest.fn(async () => currentDistribution),
  readDistributionView: jest.fn(async () => ({ id: 'distribution-1' })),
}));
const { HandoffCommandsService } = await import('../src/distributions/handoff-commands.service');

function distribution(overrides: Partial<DistributionContext> = {}): Record<string, unknown> {
  return {
    id: 'distribution-1',
    warehouse_id: 'warehouse-1',
    warehouse_status: 'ACTIVE',
    campaign_id: null,
    status: 'DISPATCHED',
    preparer_user_id: 'preparer-1',
    approver_user_id: 'approver-1',
    approved_version: 2,
    dispatch_actor_user_id: dispatcherId,
    version: 3,
    ...overrides,
  };
}

function serviceFor(userId: string, grants: Grant[]) {
  const manager = { query: jest.fn(async () => []) } as unknown as EntityManager;
  const idempotency = {
    execute: jest.fn(async (_dataSource: unknown, options: { execute: (m: EntityManager) => Promise<unknown> }) => options.execute(manager)),
  };
  const sessions = { require: jest.fn(async () => ({ userId, grants, identityHeaders: {} })) };
  const service = new HandoffCommandsService({} as DataSource, idempotency as never, sessions as never);
  const request = { idempotencyKey: '44444444-4444-4444-8444-444444444444' } as never;
  const dto = { handoff_kind: 'DIRECT_HOUSEHOLD', receiver_label: 'Hộ dân', confirmation_basis: 'Ký nhận', occurred_at: '2026-01-01T00:00:00.000Z', lines: [] } as never;
  return { service, request, dto };
}

const systemOperations: Grant[] = [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }];
const campaignOperations: Grant[] = [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'CAMPAIGN', campaign_id: campaignA }];

describe('handoff separation of duties', () => {
  it('rejects a handoff recorded by the same user who dispatched the distribution', async () => {
    currentDistribution = distribution();
    const { service, request, dto } = serviceFor(dispatcherId, systemOperations);

    await expect(service.create('distribution-1', dto, request))
      .rejects.toMatchObject({ code: 'SELF_HANDOFF_FORBIDDEN', status: 403 });
  });

  it('does not apply the self-handoff rule to a different recorder', async () => {
    currentDistribution = distribution();
    const { service, request, dto } = serviceFor(otherUserId, systemOperations);

    await expect(service.create('distribution-1', dto, request))
      .rejects.not.toMatchObject({ code: 'SELF_HANDOFF_FORBIDDEN' });
  });

  it('hides a distribution from a campaign-scoped operations manager of another campaign', async () => {
    currentDistribution = distribution({ campaign_id: campaignB });
    const { service, request, dto } = serviceFor(otherUserId, campaignOperations);

    await expect(service.create('distribution-1', dto, request))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});
