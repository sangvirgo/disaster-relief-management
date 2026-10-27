import { jest } from '@jest/globals';
import type { DataSource, EntityManager } from 'typeorm';
import type { Grant } from '../../../packages/identity-contracts/src/permissions';
import type { IdempotencyService } from '../../../packages/technical/src/idempotency/idempotency';
import type { LogisticsSessionService } from '../src/auth/logistics-session.service';
import { NeedCommitmentsService } from '../src/needs/need-commitments.service';
import type { NeedCommandRequest } from '../src/needs/needs.helpers';
import type { LogisticsResponseCampaignClient } from '../src/integrations/response/response-campaign.client';

const needId = '55555555-5555-4555-8555-555555555555';
const cycleId = '33333333-3333-4333-8333-333333333333';
const organizationId = '22222222-2222-4222-8222-222222222222';
const actorId = '66666666-6666-4666-8666-666666666666';
const itemId = '44444444-4444-4444-8444-444444444444';
const warehouseId = '88888888-8888-4888-8888-888888888888';
const campaignId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const commitmentId = '99999999-9999-4999-8999-999999999999';
const balanceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const request = { idempotencyKey: '77777777-7777-4777-8777-777777777777' } as NeedCommandRequest;

const managerGrant: Grant = {
  role_code: 'OPERATIONS_MANAGER', scope_type: 'ORGANIZATION', organization_id: organizationId,
};

const need = {
  id: needId, cycle_id: cycleId, request_id: '11111111-1111-4111-8111-111111111111', work_cycle: 2,
  organization_id: organizationId, region_code: 'NORTH', campaign_id: null, item_id: itemId,
  item_name: 'Nước uống', unit_code: 'L', unit_name: 'Lít', unit_scale: 2,
  original_quantity: '3.00', requested_quantity: '3.00', cancelled_remaining: null,
  designated_point_id: null, status: 'OPEN', version: 1, created_at: new Date('2026-10-12T12:00:00.000Z'),
};

type Commitment = {
  id: string; warehouse_id: string; quantity: string; released_quantity: string;
  issued_quantity: string; delivered_quantity: string; returned_quantity: string; lost_quantity: string; version: number;
};

type SetupOptions = {
  cycleState?: 'OPEN' | 'FROZEN' | 'SEALED';
  campaign?: string | null;
  campaignStatus?: 'ACTIVE' | 'PAUSED' | 'DRAFT' | 'CLOSED';
  needStatus?: 'OPEN' | 'FULFILLED' | 'CANCELLED';
  requested?: string;
  commitments?: Commitment[];
  balance?: { on_hand: string; reserved: string } | null;
  grants?: Grant[];
  replay?: boolean;
};

function setup(options: SetupOptions = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const cycle = {
    id: cycleId, organization_id: organizationId, region_code: 'NORTH',
    campaign_id: options.campaign ?? null, state: options.cycleState ?? 'OPEN',
  };
  const lockedNeed = { ...need, campaign_id: cycle.campaign_id, status: options.needStatus ?? 'OPEN', requested_quantity: options.requested ?? '3.00' };
  const commitments = options.commitments ?? [];
  const warehouse = { id: warehouseId, organization_id: organizationId, region_code: 'NORTH', status: 'ACTIVE' };
  const balance = options.balance === null ? [] : [{ id: balanceId, warehouse_id: warehouseId, item_id: itemId, ...options.balance ?? { on_hand: '5.00', reserved: '2.00' } }];
  const manager = {
    query: jest.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes('FROM relief_need') && sql.includes('JOIN fulfillment_cycle') && sql.includes('FOR UPDATE OF n')) return [lockedNeed];
      if (sql.includes('SELECT cycle_id FROM relief_need')) return [{ cycle_id: cycleId }];
      if (sql.includes('FROM fulfillment_cycle') && sql.includes('FOR UPDATE')) return [cycle];
      if (sql.includes('FROM commitment') && sql.includes('FOR UPDATE')) return commitments;
      if (sql.includes('FROM warehouse')) return [warehouse];
      if (sql.includes('FROM stock_balance')) return balance;
      if (sql.includes('INSERT INTO commitment')) return [{ id: commitmentId }];
      if (sql.includes('UPDATE commitment')) return [{ id: values?.[0] }];
      if (sql.includes('INSERT INTO stock_movement') || sql.includes('INSERT INTO audit_log')) return [];
      if (sql.includes('FROM commitment')) return [{
        id: commitmentId, relief_need_id: needId, item_id: itemId, warehouse_id: warehouseId,
        cycle_id: cycleId, organization_id: organizationId, region_code: 'NORTH', campaign_id: null,
        unit_scale: 2, status: 'OPEN', requested_quantity: '3.00',
        quantity: '2.00', released_quantity: '1.00', issued_quantity: '0.00', delivered_quantity: '0.00',
        returned_quantity: '0.00', lost_quantity: '0.00', version: 4,
      }];
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  } as unknown as EntityManager;
  const dataSource = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM relief_need')) return [{
        ...lockedNeed, cycle_id: cycleId, warehouse_id: warehouseId, warehouse_organization_id: organizationId,
        warehouse_region_code: 'NORTH',
      }];
      if (sql.includes('FROM commitment')) return [{
        id: commitmentId, relief_need_id: needId, cycle_id: cycleId, organization_id: organizationId,
        region_code: 'NORTH', warehouse_id: warehouseId, warehouse_organization_id: organizationId,
        warehouse_region_code: 'NORTH', item_id: itemId,
      }];
      if (sql.includes('FROM warehouse')) return [warehouse];
      return [];
    }),
  };
  const idempotency = {
    execute: jest.fn(async (_source: unknown, command: {
      status?: number;
      execute(manager: EntityManager): Promise<{ status: number; value: Record<string, unknown>; resource: unknown }>;
      replay(manager: EntityManager, resource: { type: string; id: string } | null, status: number): Promise<Record<string, unknown>>;
    }) => options.replay
      ? { status: 201, value: await command.replay(manager, { type: 'commitment', id: commitmentId }, 201), replay: true }
      : { ...(await command.execute(manager)), replay: false }),
  };
  const sessions = {
    require: jest.fn(async () => ({ userId: actorId, grants: options.grants ?? [managerGrant], identityHeaders: {} })),
  };
  const campaigns = {
    getCampaign: jest.fn(async (id: string) => ({
      id, status: options.campaignStatus ?? 'ACTIVE', organization_id: organizationId, region_code: 'NORTH', version: 1,
    })),
  };
  const service = new NeedCommitmentsService(
    dataSource as unknown as DataSource,
    idempotency as unknown as IdempotencyService,
    sessions as unknown as LogisticsSessionService,
    campaigns as unknown as LogisticsResponseCampaignClient,
  );
  return { service, calls, manager, dataSource, idempotency, campaigns };
}

describe('NeedCommitmentsService', () => {
  it('reserves available stock after locking cycle, need, and commitments', async () => {
    const { service, calls, manager, idempotency } = setup({
      commitments: [{
        id: 'commitment-old', warehouse_id: warehouseId, quantity: '1.00', released_quantity: '0.00',
        issued_quantity: '0.00', delivered_quantity: '0.00', returned_quantity: '0.00', lost_quantity: '0.00', version: 1,
      }],
      balance: { on_hand: '5.00', reserved: '2.00' },
    });

    const result = await service.create(needId, { warehouse_id: warehouseId, quantity: '1.50' }, request);

    const sql = calls.map((call) => call.sql);
    const cycleLock = sql.findIndex((value) => value.includes('FROM fulfillment_cycle') && value.includes('FOR UPDATE'));
    const needLock = sql.findIndex((value) => value.includes('FOR UPDATE OF n'));
    const commitmentLock = sql.findIndex((value) => value.includes('FROM commitment') && value.includes('FOR UPDATE'));
    const balanceRead = sql.findIndex((value) => value.includes('FROM stock_balance'));
    expect(cycleLock).toBeLessThan(needLock);
    expect(needLock).toBeLessThan(commitmentLock);
    expect(commitmentLock).toBeLessThan(balanceRead);
    expect(calls.find((call) => call.sql.includes("VALUES ($1,'RESERVE'"))?.values).toEqual([
      balanceId, '1.50', commitmentId, `COMMITMENT_RESERVE:${commitmentId}`, actorId,
    ]);
    expect(calls.some((call) => call.sql.includes('INSERT INTO audit_log') && call.values?.[1] === 'COMMITMENT_CREATED')).toBe(true);
    expect(result.value).toMatchObject({ id: commitmentId, quantity: '1.50' });
    expect(idempotency.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      command: 'logistics.needs.commitments.create',
      databaseErrorMappings: { check: { stock_balance_check: 'INSUFFICIENT_STOCK' } },
    }));
    expect(manager.query).toHaveBeenCalled();
  });

  it('rejects a commitment that would exceed the requested need', async () => {
    const { service, calls } = setup({
      requested: '3.00',
      commitments: [{
        id: 'commitment-old', warehouse_id: warehouseId, quantity: '2.50', released_quantity: '0.00',
        issued_quantity: '1.00', delivered_quantity: '0.50', returned_quantity: '0.00', lost_quantity: '0.00', version: 1,
      }],
    });

    await expect(service.create(needId, { warehouse_id: warehouseId, quantity: '0.51' }, request))
      .rejects.toMatchObject({ code: 'NEED_OVER_COMMITTED', status: 409 });
    expect(calls.some((call) => call.sql.includes('INSERT INTO commitment'))).toBe(false);
  });

  it('requires commitment permission and rejects cancelled needs or unavailable stock', async () => {
    const denied = setup({ grants: [{ ...managerGrant, role_code: 'COORDINATOR' }] });
    await expect(denied.service.create(needId, { warehouse_id: warehouseId, quantity: '1.00' }, request))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    const cancelled = setup({ needStatus: 'CANCELLED' });
    await expect(cancelled.service.create(needId, { warehouse_id: warehouseId, quantity: '1.00' }, request))
      .rejects.toMatchObject({ code: 'STATE_TRANSITION_INVALID', status: 409 });

    const unavailable = setup({ balance: { on_hand: '1.00', reserved: '0.50' } });
    await expect(unavailable.service.create(needId, { warehouse_id: warehouseId, quantity: '0.51' }, request))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK', status: 409 });
    expect(unavailable.calls.some((call) => call.sql.includes('INSERT INTO commitment'))).toBe(false);
  });

  it('rejects a paused campaign before locking business rows', async () => {
    const { service, calls } = setup({ campaign: campaignId, campaignStatus: 'PAUSED' });

    await expect(service.create(needId, { warehouse_id: warehouseId, quantity: '1.00' }, request))
      .rejects.toMatchObject({ code: 'CAMPAIGN_PAUSED', status: 409 });
    expect(calls.some((call) => call.sql.includes('FROM commitment') && call.sql.includes('FOR UPDATE'))).toBe(false);
  });

  it('replays a prior create even if the linked campaign is now paused', async () => {
    const { service, calls, campaigns } = setup({ campaign: campaignId, campaignStatus: 'PAUSED', replay: true });

    const result = await service.create(needId, { warehouse_id: warehouseId, quantity: '1.00' }, request);

    expect(result.replay).toBe(true);
    expect(result.value).toMatchObject({ id: commitmentId, relief_need_id: needId });
    expect(campaigns.getCampaign).toHaveBeenCalledWith(campaignId);
    expect(calls.some((call) => call.sql.includes('FROM commitment') && call.sql.includes('FOR UPDATE'))).toBe(false);
  });

  it('releases only unissued stock on a frozen cycle and records the release movement', async () => {
    const { service, calls } = setup({
      cycleState: 'FROZEN',
      commitments: [{
        id: commitmentId, warehouse_id: warehouseId, quantity: '2.00', released_quantity: '1.00',
        issued_quantity: '0.00', delivered_quantity: '0.00', returned_quantity: '0.00', lost_quantity: '0.00', version: 4,
      }],
      balance: { on_hand: '5.00', reserved: '1.00' },
    });

    await service.release(commitmentId, { expected_version: 4, quantity: '0.50', reason: 'Điều chỉnh phân bổ.' }, request);

    const sql = calls.map((call) => call.sql);
    expect(sql.findIndex((value) => value.includes('FROM fulfillment_cycle') && value.includes('FOR UPDATE')))
      .toBeLessThan(sql.findIndex((value) => value.includes('FOR UPDATE OF n')));
    expect(sql.findIndex((value) => value.includes('FOR UPDATE OF n')))
      .toBeLessThan(sql.findIndex((value) => value.includes('FROM commitment') && value.includes('FOR UPDATE')));
    const commitmentLock = sql.findIndex((value) => value.includes('FROM commitment') && value.includes('FOR UPDATE'));
    const balanceRead = sql.findIndex((value) => value.includes('FROM stock_balance'));
    expect(commitmentLock).toBeLessThan(balanceRead);
    expect(sql[balanceRead]).not.toMatch(/FOR UPDATE/u);
    expect(calls.find((call) => call.sql.includes('UPDATE commitment'))?.values).toEqual([commitmentId, '0.50', 4]);
    expect(calls.find((call) => call.sql.includes("VALUES ($1,'RELEASE'"))?.values).toEqual([
      balanceId, '0.50', commitmentId, `COMMITMENT_RELEASE:${commitmentId}:4`, actorId,
    ]);
    expect(calls.some((call) => call.sql.includes('INSERT INTO audit_log') && call.values?.[1] === 'COMMITMENT_RELEASED')).toBe(true);
  });

  it('rejects releases on sealed cycles and stale commitment versions', async () => {
    const sealed = setup({ cycleState: 'SEALED' });
    await expect(sealed.service.release(commitmentId, { expected_version: 4, quantity: '0.50', reason: 'Điều chỉnh.' }, request))
      .rejects.toMatchObject({ code: 'CYCLE_SEALED', status: 409 });

    const stale = setup({ commitments: [{
      id: commitmentId, warehouse_id: warehouseId, quantity: '2.00', released_quantity: '1.00',
      issued_quantity: '0.00', delivered_quantity: '0.00', returned_quantity: '0.00', lost_quantity: '0.00', version: 4,
    }] });
    await expect(stale.service.release(commitmentId, { expected_version: 3, quantity: '0.50', reason: 'Điều chỉnh.' }, request))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    expect(stale.calls.some((call) => call.sql.includes("VALUES ($1,'RELEASE'"))).toBe(false);
  });

  it('does not release any quantity already issued', async () => {
    const { service, calls } = setup({ commitments: [{
      id: commitmentId, warehouse_id: warehouseId, quantity: '2.00', released_quantity: '1.00',
      issued_quantity: '0.50', delivered_quantity: '0.00', returned_quantity: '0.00', lost_quantity: '0.00', version: 4,
    }] });

    await expect(service.release(commitmentId, { expected_version: 4, quantity: '0.51', reason: 'Điều chỉnh.' }, request))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(calls.some((call) => call.sql.includes("VALUES ($1,'RELEASE'"))).toBe(false);
  });
});
