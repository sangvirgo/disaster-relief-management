import { jest } from '@jest/globals';
import type { DataSource, EntityManager } from 'typeorm';
import type { Grant } from '../../../packages/technical/src/security/permissions';
import type { IdempotencyService } from '../../../packages/technical/src/idempotency/idempotency';
import type { LogisticsSessionService } from '../src/auth/logistics-session.service';
import { NeedCommandsService } from '../src/needs/need-commands.service';
import type { AdjustNeedQuantityDto, CancelNeedDto } from '../src/needs/needs.dto';
import type { NeedCommandRequest } from '../src/needs/needs.helpers';

const needId = '55555555-5555-4555-8555-555555555555';
const cycleId = '33333333-3333-4333-8333-333333333333';
const organizationId = '22222222-2222-4222-8222-222222222222';
const actorId = '66666666-6666-4666-8666-666666666666';
const itemId = '44444444-4444-4444-8444-444444444444';
const warehouseId = '88888888-8888-4888-8888-888888888888';

const coordinatorGrant: Grant = {
  role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId,
};

const baseNeed = {
  id: needId,
  cycle_id: cycleId,
  request_id: '11111111-1111-4111-8111-111111111111',
  work_cycle: 2,
  organization_id: organizationId,
  region_code: 'NORTH',
  campaign_id: null,
  item_id: itemId,
  item_name: 'Nước uống',
  unit_code: 'L',
  unit_name: 'Lít',
  unit_scale: 0,
  original_quantity: '3',
  requested_quantity: '3',
  cancelled_remaining: null,
  designated_point_id: null,
  status: 'OPEN',
  version: 1,
  created_at: new Date('2026-10-12T12:00:00.000Z'),
};

type SetupOptions = {
  cycleState?: 'OPEN' | 'FROZEN' | 'SEALED';
  need?: Partial<typeof baseNeed>;
  commitments?: Array<{
    id: string; warehouse_id: string; quantity: string; released_quantity: string;
    issued_quantity: string; delivered_quantity: string; returned_quantity: string; lost_quantity: string; version: number;
  }>;
  balances?: Array<{ id: string; warehouse_id: string; item_id: string; reserved: string }>;
};

function setup(options: SetupOptions = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const statements: string[] = [];
  const need = { ...baseNeed, ...options.need };
  const cycle = {
    id: cycleId,
    organization_id: organizationId,
    region_code: 'NORTH',
    campaign_id: null,
    state: options.cycleState ?? 'OPEN',
  };
  const commitments = options.commitments ?? [];
  const balances = options.balances ?? [];
  const manager = {
    query: jest.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      statements.push(sql);
      if (sql.includes('SELECT cycle_id FROM relief_need')) return [{ cycle_id: cycleId }];
      if (sql.includes('FROM fulfillment_cycle') && sql.includes('FOR UPDATE')) return [cycle];
      if (sql.includes('FROM relief_need n JOIN fulfillment_cycle') && sql.includes('FOR UPDATE OF n')) return [need];
      if (sql.includes('FROM commitment') && sql.includes('FOR UPDATE')) return commitments;
      if (sql.includes('FROM stock_balance') && sql.includes('FOR UPDATE')) return balances;
      if (sql.includes('INSERT INTO stock_movement')) return [];
      if (sql.includes('UPDATE commitment')) return [{ id: values?.[0] }];
      if (sql.includes('UPDATE relief_need')) return [{ id: needId }];
      if (sql.includes('FROM relief_need n JOIN fulfillment_cycle')) return [need];
      if (sql.includes('INSERT INTO audit_log')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  } as unknown as EntityManager;
  const dataSource = {
    query: jest.fn(async (sql: string) => sql.includes('FROM relief_need n JOIN fulfillment_cycle')
      ? [{ organization_id: organizationId, region_code: 'NORTH', campaign_id: null }]
      : []),
    transaction: jest.fn(async (run: (manager: EntityManager) => Promise<unknown>) => run(manager)),
  };
  const idempotency = {
    execute: jest.fn(async (_source: unknown, command: {
      execute(manager: EntityManager): Promise<{ status: number; value: Record<string, unknown> }>;
    }) => ({ ...(await command.execute(manager)), replay: false })),
  };
  const sessions = {
    require: jest.fn(async () => ({ userId: actorId, grants: [coordinatorGrant], identityHeaders: {} })),
  };
  const service = new NeedCommandsService(
    dataSource as unknown as DataSource,
    idempotency as unknown as IdempotencyService,
    sessions as unknown as LogisticsSessionService,
  );
  const request = { idempotencyKey: '77777777-7777-4777-8777-777777777777' } as NeedCommandRequest;
  return { service, calls, statements, manager, idempotency, sessions, request };
}

describe('NeedCommandsService', () => {
  it('increases requested quantity on an open cycle and reopens a fulfilled need as partially fulfilled', async () => {
    const need = { ...baseNeed, status: 'FULFILLED', requested_quantity: '3', version: 4 };
    const { service, statements, calls, request, idempotency } = setup({
      need,
      commitments: [{
        id: 'commitment-1', warehouse_id: warehouseId, quantity: '3', released_quantity: '0',
        issued_quantity: '3', delivered_quantity: '3', returned_quantity: '0', lost_quantity: '0', version: 1,
      }],
    });

    await service.increase(needId, { expected_version: 4, quantity: '5', reason: 'Bổ sung nhu cầu.' }, request);

    expect(statements.findIndex((sql) => sql.includes('FROM fulfillment_cycle') && sql.includes('FOR UPDATE')))
      .toBeLessThan(statements.findIndex((sql) => sql.includes('FOR UPDATE OF n')));
    expect(calls.find((call) => call.sql.includes('UPDATE relief_need'))?.values).toEqual([needId, 4, '5', 'PARTIALLY_FULFILLED']);
    expect(calls.some((call) => call.sql.includes('INSERT INTO audit_log') && call.values?.[1] === 'NEED_INCREASED')).toBe(true);
    expect(idempotency.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ command: 'logistics.needs.increase' }));
  });

  it('rejects a reduction below delivered, reserved, and unsettled issued quantities', async () => {
    const { service, calls, request } = setup({
      commitments: [{
        id: 'commitment-1', warehouse_id: warehouseId, quantity: '6', released_quantity: '0',
        issued_quantity: '2', delivered_quantity: '1', returned_quantity: '0', lost_quantity: '0', version: 1,
      }],
    });

    await expect(service.reduce(needId, { expected_version: 1, quantity: '2', reason: 'Điều chỉnh.' }, request))
      .rejects.toMatchObject({ code: 'BELOW_PROTECTED_QUANTITY', status: 409 });
    expect(calls.some((call) => call.sql.includes('UPDATE relief_need'))).toBe(false);
  });

  it('marks a reduced need fulfilled when the new request equals delivered quantity', async () => {
    const { service, calls, request } = setup({
      need: { ...baseNeed, requested_quantity: '5' },
      commitments: [{
        id: 'commitment-1', warehouse_id: warehouseId, quantity: '5', released_quantity: '0',
        issued_quantity: '5', delivered_quantity: '4', returned_quantity: '1', lost_quantity: '0', version: 1,
      }],
    });

    await service.reduce(needId, { expected_version: 1, quantity: '4', reason: 'Đã giao đủ.' }, request);

    expect(calls.find((call) => call.sql.includes('UPDATE relief_need'))?.values).toEqual([needId, 1, '4', 'FULFILLED']);
  });

  it('allows cancellation in a frozen cycle and releases each reservation through the movement ledger', async () => {
    const commitments = [{
      id: 'commitment-1', warehouse_id: warehouseId, quantity: '4', released_quantity: '1',
      issued_quantity: '0', delivered_quantity: '0', returned_quantity: '0', lost_quantity: '0', version: 7,
    }];
    const { service, calls, request } = setup({
      cycleState: 'FROZEN',
      commitments,
      balances: [{ id: 'balance-1', warehouse_id: warehouseId, item_id: itemId, reserved: '3' }],
    });

    await service.cancel(needId, { expected_version: 1, reason: 'Không còn cần.' }, request);

    expect(calls.some((call) => call.sql.includes('INSERT INTO stock_movement'))).toBe(true);
    expect(calls.find((call) => call.sql.includes('INSERT INTO stock_movement'))?.values).toEqual([
      'balance-1', '3', 'commitment-1', `NEED_CANCEL:${needId}:commitment-1`, actorId,
    ]);
    expect(calls.some((call) => call.sql.includes('UPDATE commitment'))).toBe(true);
    expect(calls.find((call) => call.sql.includes('UPDATE commitment'))?.values).toEqual(['commitment-1', '3', 7]);
    expect(calls.find((call) => call.sql.includes('UPDATE relief_need'))?.values).toEqual([needId, 1, '3']);
  });

  it('formats scaled reservation quantities as decimals in release movements', async () => {
    const { service, calls, request } = setup({
      need: { ...baseNeed, unit_scale: 1, requested_quantity: '4.0' },
      commitments: [{
        id: 'commitment-1', warehouse_id: warehouseId, quantity: '4.0', released_quantity: '2.5',
        issued_quantity: '0.0', delivered_quantity: '0.0', returned_quantity: '0.0', lost_quantity: '0.0', version: 1,
      }],
      balances: [{ id: 'balance-1', warehouse_id: warehouseId, item_id: itemId, reserved: '1.5' }],
    });

    await service.cancel(needId, { expected_version: 1, reason: 'Không còn cần.' }, request);

    expect(calls.find((call) => call.sql.includes('INSERT INTO stock_movement'))?.values?.[1]).toBe('1.5');
  });

  it('rejects cancellation while any issued quantity remains unsettled', async () => {
    const { service, calls, request } = setup({
      commitments: [{
        id: 'commitment-1', warehouse_id: warehouseId, quantity: '3', released_quantity: '0',
        issued_quantity: '2', delivered_quantity: '1', returned_quantity: '0', lost_quantity: '0', version: 1,
      }],
    });

    await expect(service.cancel(needId, { expected_version: 1, reason: 'Hủy.' }, request))
      .rejects.toMatchObject({ code: 'UNSETTLED_ISSUED_GOODS', status: 409 });
    expect(calls.some((call) => call.sql.includes('INSERT INTO stock_movement'))).toBe(false);
  });

  it('rejects increase and reduce on a frozen cycle but allows cancellation there', async () => {
    const increase = setup({ cycleState: 'FROZEN' });
    const reduce = setup({ cycleState: 'FROZEN' });

    await expect(increase.service.increase(needId, { expected_version: 1, quantity: '4', reason: 'Tăng.' }, increase.request))
      .rejects.toMatchObject({ code: 'CYCLE_FROZEN', status: 409 });
    await expect(reduce.service.reduce(needId, { expected_version: 1, quantity: '2', reason: 'Giảm.' }, reduce.request))
      .rejects.toMatchObject({ code: 'CYCLE_FROZEN', status: 409 });
  });

  it('rejects a stale expected version', async () => {
    const { service, request } = setup({ need: { ...baseNeed, version: 2 } });

    await expect(service.increase(needId, { expected_version: 1, quantity: '4', reason: 'Tăng.' }, request))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
  });
});
