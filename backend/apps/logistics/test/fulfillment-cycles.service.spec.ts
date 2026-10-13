import { jest } from '@jest/globals';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../packages/technical/src/errors/errors';
import type { ResponseCycleIntent, ResponseCycleIntentClient } from '../src/integrations/response/response-cycle-intent.client';
import { FulfillmentCyclesService } from '../src/fulfillment-cycles/fulfillment-cycles.service';

const requestId = '11111111-1111-4111-8111-111111111111';
const intentId = '22222222-2222-4222-8222-222222222222';
const organizationId = '33333333-3333-4333-8333-333333333333';
const cycleId = '44444444-4444-4444-8444-444444444444';

function setup(options: {
  intent?: Partial<ResponseCycleIntent>;
  cycleState?: 'OPEN' | 'FROZEN' | 'SEALED';
  sameIntent?: { intent_id: string; cycle_id: string; kind: string; state: string } | null;
  liveIntent?: { intent_id: string; kind: string; state: string } | null;
  settlement?: { has_open_needs: boolean; has_reserved: boolean; has_unsettled_issued: boolean; has_delivered: boolean };
} = {}) {
  const order: string[] = [];
  const sqlCalls: string[] = [];
  const cycle = {
    id: cycleId,
    request_id: requestId,
    work_cycle: 3,
    organization_id: organizationId,
    region_code: 'NORTH',
    campaign_id: null,
    state: options.cycleState ?? 'OPEN',
  };
  const responseIntent: ResponseCycleIntent = {
    id: intentId,
    kind: 'RESOLUTION',
    state: 'PENDING',
    request_id: requestId,
    work_cycle: 3,
    request_status: 'RESOLVING',
    organization_id: organizationId,
    region_code: 'NORTH',
    campaign_id: null,
    outcome_basis: 'RESCUE_COMPLETED',
    ...options.intent,
  };
  const manager = {
    query: jest.fn(async (sql: string) => {
      sqlCalls.push(sql);
      if (sql.includes('INSERT INTO fulfillment_cycle')) return [];
      if (sql.includes('FROM fulfillment_cycle') && sql.includes('FOR UPDATE')) return [cycle];
      if (sql.includes('FROM cycle_intent') && sql.includes('intent_id=$1')) return options.sameIntent ? [options.sameIntent] : [];
      if (sql.includes('FROM cycle_intent') && sql.includes("state <> 'ABORTED'")) return options.liveIntent ? [options.liveIntent] : [];
      if (sql.includes('has_open_needs')) return [options.settlement ?? {
        has_open_needs: false,
        has_reserved: false,
        has_unsettled_issued: false,
        has_delivered: true,
      }];
      if (sql.includes('INSERT INTO cycle_intent') || sql.includes('UPDATE fulfillment_cycle') || sql.includes('UPDATE cycle_intent')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  } as unknown as EntityManager;
  const dataSource = {
    transaction: jest.fn(async (operation: (manager: EntityManager) => Promise<unknown>) => {
      order.push('transaction');
      return operation(manager);
    }),
  };
  const response = {
    getIntent: jest.fn(async () => {
      order.push('response-precheck');
      return responseIntent;
    }),
  };
  const service = new FulfillmentCyclesService(
    dataSource as unknown as DataSource,
    response as unknown as ResponseCycleIntentClient,
  );
  return { service, dataSource, response, order, sqlCalls };
}

describe('FulfillmentCyclesService', () => {
  it('prechecks Response before opening a transaction, then freezes the locked cycle', async () => {
    const { service, order, sqlCalls, dataSource } = setup({ intent: { kind: 'CANCELLATION' } });

    await expect(service.freeze(requestId, 3, { intent_id: intentId })).resolves.toMatchObject({
      intent_id: intentId,
      request_id: requestId,
      work_cycle: 3,
      cycle_state: 'FROZEN',
    });

    expect(order).toEqual(['response-precheck', 'transaction']);
    const cycleLock = sqlCalls.findIndex((sql) => sql.includes('FROM fulfillment_cycle') && sql.includes('FOR UPDATE'));
    const intentRead = sqlCalls.findIndex((sql) => sql.includes('FROM cycle_intent'));
    expect(cycleLock).toBeGreaterThanOrEqual(0);
    expect(intentRead).toBeGreaterThan(cycleLock);
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('seals a settled cycle when the request basis exactly matches Response', async () => {
    const { service, sqlCalls } = setup();

    await expect(service.seal(requestId, 3, { intent_id: intentId, outcome_basis: 'RESCUE_COMPLETED' }))
      .resolves.toMatchObject({ cycle_state: 'SEALED' });

    expect(sqlCalls.some((sql) => sql.includes('INSERT INTO cycle_intent'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('UPDATE fulfillment_cycle'))).toBe(true);
  });

  it('rejects an outcome basis that differs from Response before opening a transaction', async () => {
    const { service, dataSource } = setup();

    await expect(service.seal(requestId, 3, { intent_id: intentId, outcome_basis: 'SUPPLY_ONLY' }))
      .rejects.toMatchObject({ code: 'STATE_TRANSITION_INVALID', status: 409 });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('requires delivered aid and fully settled needs for SUPPLY_ONLY', async () => {
    const { service } = setup({
      intent: { outcome_basis: 'SUPPLY_ONLY' },
      settlement: { has_open_needs: false, has_reserved: false, has_unsettled_issued: false, has_delivered: false },
    });

    await expect(service.seal(requestId, 3, { intent_id: intentId, outcome_basis: 'SUPPLY_ONLY' }))
      .rejects.toMatchObject({ code: 'CYCLE_NOT_SETTLED', status: 409 });
  });

  it('reports open needs, reservations, and unsettled issues as seal blockers', async () => {
    const blockers = [
      { settlement: { has_open_needs: true, has_reserved: false, has_unsettled_issued: false, has_delivered: true }, reason: 'OPEN_NEED' },
      { settlement: { has_open_needs: false, has_reserved: true, has_unsettled_issued: false, has_delivered: true }, reason: 'RESERVED_QUANTITY' },
      { settlement: { has_open_needs: false, has_reserved: false, has_unsettled_issued: true, has_delivered: true }, reason: 'UNSETTLED_ISSUE' },
    ] as const;

    for (const blocker of blockers) {
      const { service } = setup({ settlement: blocker.settlement });
      await expect(service.seal(requestId, 3, { intent_id: intentId, outcome_basis: 'RESCUE_COMPLETED' }))
        .rejects.toMatchObject({ code: 'CYCLE_NOT_SETTLED', status: 409, details: { reasons: [blocker.reason] } });
    }
  });

  it('requires zero delivered and reserved quantities for NO_ACTION_REQUIRED', async () => {
    const { service } = setup({
      intent: { outcome_basis: 'NO_ACTION_REQUIRED' },
      settlement: { has_open_needs: false, has_reserved: false, has_unsettled_issued: false, has_delivered: true },
    });

    await expect(service.seal(requestId, 3, { intent_id: intentId, outcome_basis: 'NO_ACTION_REQUIRED' }))
      .rejects.toMatchObject({ code: 'CYCLE_NOT_SETTLED', status: 409 });
  });

  it('rejects reservations for NO_ACTION_REQUIRED even when there is no delivery', async () => {
    const { service } = setup({
      intent: { outcome_basis: 'NO_ACTION_REQUIRED' },
      settlement: { has_open_needs: false, has_reserved: true, has_unsettled_issued: false, has_delivered: false },
    });

    await expect(service.seal(requestId, 3, { intent_id: intentId, outcome_basis: 'NO_ACTION_REQUIRED' }))
      .rejects.toMatchObject({ code: 'CYCLE_NOT_SETTLED', status: 409, details: { reasons: ['RESERVED_QUANTITY'] } });
  });

  it('records a durable abort tombstone for an unbound open cycle', async () => {
    const { service, sqlCalls } = setup({
      intent: { kind: 'RESOLUTION', state: 'ABORTING', request_status: 'CANCELLING' },
    });

    await expect(service.unseal(requestId, 3, { intent_id: intentId })).resolves.toMatchObject({ cycle_state: 'OPEN' });
    expect(sqlCalls.some((sql) => sql.includes('INSERT INTO cycle_intent'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('UPDATE fulfillment_cycle'))).toBe(false);
  });

  it('aborts only the exact live freeze binding and reopens its cycle', async () => {
    const { service, sqlCalls } = setup({
      intent: { kind: 'CANCELLATION', state: 'ABORTING', request_status: 'CANCELLING' },
      sameIntent: { intent_id: intentId, cycle_id: cycleId, kind: 'CANCELLATION', state: 'FROZEN' },
      liveIntent: { intent_id: intentId, kind: 'CANCELLATION', state: 'FROZEN' },
      cycleState: 'FROZEN',
    });

    await expect(service.unseal(requestId, 3, { intent_id: intentId })).resolves.toMatchObject({ cycle_state: 'OPEN' });
    expect(sqlCalls.some((sql) => sql.includes("UPDATE cycle_intent SET state='ABORTED'"))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes("UPDATE fulfillment_cycle SET state='OPEN'"))).toBe(true);
  });

  it('rejects a stale unseal when another intent currently owns the cycle', async () => {
    const { service } = setup({
      intent: { state: 'ABORTING', request_status: 'CANCELLING' },
      liveIntent: { intent_id: '55555555-5555-4555-8555-555555555555', kind: 'RESOLUTION', state: 'SEALED' },
      cycleState: 'SEALED',
    });

    await expect(service.unseal(requestId, 3, { intent_id: intentId }))
      .rejects.toMatchObject({ code: 'STATE_TRANSITION_INVALID', status: 409 });
  });

  it('replays an exact live seal binding without adding another intent row', async () => {
    const { service, sqlCalls } = setup({
      sameIntent: { intent_id: intentId, cycle_id: cycleId, kind: 'RESOLUTION', state: 'SEALED' },
      liveIntent: { intent_id: intentId, kind: 'RESOLUTION', state: 'SEALED' },
      cycleState: 'SEALED',
    });

    await expect(service.seal(requestId, 3, { intent_id: intentId, outcome_basis: 'RESCUE_COMPLETED' }))
      .resolves.toMatchObject({ cycle_state: 'SEALED' });
    expect(sqlCalls.some((sql) => sql.includes('INSERT INTO cycle_intent'))).toBe(false);
  });

  it('rejects a mismatched Response request before touching Logistics', async () => {
    const { service, dataSource } = setup({ intent: { request_id: '66666666-6666-4666-8666-666666666666' } });

    await expect(service.freeze(requestId, 3, { intent_id: intentId }))
      .rejects.toMatchObject({ code: 'STATE_TRANSITION_INVALID', status: 409 });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects unseal after Response has already resolved or closed the request', async () => {
    const { service, dataSource } = setup({ intent: { state: 'ABORTING', request_status: 'RESOLVED' } });

    await expect(service.unseal(requestId, 3, { intent_id: intentId }))
      .rejects.toMatchObject({ code: 'STATE_TRANSITION_INVALID', status: 409 });
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects a late freeze when its durable intent has an ABORTED tombstone', async () => {
    const { service } = setup({
      intent: { kind: 'CANCELLATION' },
      sameIntent: { intent_id: intentId, cycle_id: cycleId, kind: 'CANCELLATION', state: 'ABORTED' },
    });

    await expect(service.freeze(requestId, 3, { intent_id: intentId }))
      .rejects.toMatchObject({ code: 'STATE_TRANSITION_INVALID', status: 409 });
  });
});
