import { jest } from '@jest/globals';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../packages/technical/src/errors/errors';
import type { Grant } from '../../../packages/technical/src/security/permissions';
import { NeedsService } from '../src/needs/needs.service';
import type { CreateNeedDto } from '../src/needs/needs.dto';
import type { LogisticsSessionService } from '../src/auth/logistics-session.service';
import type { ResponseAdmissionClient } from '../src/needs/response-admission.client';
import type { IdempotencyService } from '../../../packages/technical/src/idempotency/idempotency';

const requestId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const cycleId = '33333333-3333-4333-8333-333333333333';
const itemId = '44444444-4444-4444-8444-444444444444';
const needId = '55555555-5555-4555-8555-555555555555';
const actorId = '66666666-6666-4666-8666-666666666666';

const coordinatorGrant: Grant = {
  role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId,
};
const admission = {
  request_id: requestId, work_cycle: 2, version: 5, status: 'TRIAGED',
  organization_id: organizationId, region_code: 'NORTH', campaign_id: null,
};
const needRow = {
  id: needId, cycle_id: cycleId, request_id: requestId, work_cycle: 2,
  organization_id: organizationId, region_code: 'NORTH', campaign_id: null,
  item_id: itemId, item_name: 'Nước uống', unit_code: 'L', unit_name: 'Lít',
  original_quantity: '3', requested_quantity: '3', cancelled_remaining: null,
  designated_point_id: null, status: 'OPEN', version: 1,
  created_at: new Date('2026-10-12T12:00:00.000Z'),
};

function setup(overrides: Partial<{
  cycleState: string;
  itemStatus: string;
  point: { id: string; organization_id: string; region_code: string; status: string } | null;
  grants: Grant[];
  admissionError: Error;
}> = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const order: string[] = [];
  const cycle = {
    id: cycleId, request_id: requestId, work_cycle: 2, organization_id: organizationId,
    region_code: 'NORTH', campaign_id: null, state: overrides.cycleState ?? 'OPEN',
  };
  const manager = {
    query: jest.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes('INSERT INTO fulfillment_cycle')) return [];
      if (sql.includes('FROM fulfillment_cycle') && sql.includes('FOR UPDATE')) return [cycle];
      if (sql.includes('FROM item i JOIN unit u')) return [{ id: itemId, status: overrides.itemStatus ?? 'ACTIVE', scale: 0 }];
      if (sql.includes('FROM relief_point')) return overrides.point ? [overrides.point] : [];
      if (sql.includes('INSERT INTO relief_need')) return [{ id: needId }];
      if (sql.includes('FROM relief_need n JOIN fulfillment_cycle')) return [needRow];
      if (sql.includes('INSERT INTO audit_log')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  } as unknown as EntityManager;
  const dataSource = { transaction: jest.fn(async (operation: (manager: EntityManager) => Promise<unknown>) => operation(manager)) };
  const idempotency = {
    execute: jest.fn(async (_source: unknown, command: {
      execute(manager: EntityManager): Promise<{ status: number; value: Record<string, unknown> }>;
    }) => {
      order.push('transaction');
      const result = await command.execute(manager);
      return { ...result, replay: false };
    }),
  };
  const sessions = {
    require: jest.fn(async () => {
      order.push('session');
      return {
        userId: actorId,
        grants: overrides.grants ?? [coordinatorGrant],
        identityHeaders: { authorization: 'Bearer identity.signed.actor' },
      };
    }),
  };
  const response = {
    admit: jest.fn(async () => {
      order.push('response-admission');
      if (overrides.admissionError) throw overrides.admissionError;
      return admission;
    }),
  };
  const service = new NeedsService(
    dataSource as unknown as DataSource,
    idempotency as unknown as IdempotencyService,
    sessions as unknown as LogisticsSessionService,
    response as never,
  );
  return { service, calls, order, manager, dataSource, idempotency, sessions, response };
}

const dto: CreateNeedDto = {
  request_id: requestId, work_cycle: 2, item_id: itemId, quantity: '3',
};
const request = { idempotencyKey: '77777777-7777-4777-8777-777777777777' } as Request & { idempotencyKey: string };

describe('NeedsService.create', () => {
  it('admits through Response before opening the local idempotency transaction and uses canonical attribution', async () => {
    const { service, calls, order, response, idempotency } = setup();

    const result = await service.create({ ...dto, organization_id: 'untrusted' } as CreateNeedDto, request);

    expect(order.indexOf('response-admission')).toBeLessThan(order.indexOf('transaction'));
    expect(response.admit).toHaveBeenCalledWith(requestId, 2, { authorization: 'Bearer identity.signed.actor' });
    expect(result.value).toMatchObject({
      id: needId, request_id: requestId, work_cycle: 2, organization_id: organizationId,
      region_code: 'NORTH', campaign_id: null, item_id: itemId, original_quantity: '3',
      requested_quantity: '3', delivery_target_kind: 'FINAL_RECIPIENT', status: 'OPEN', version: 1,
    });
    const cycleInsert = calls.find(({ sql }) => sql.includes('INSERT INTO fulfillment_cycle'));
    expect(cycleInsert?.values).toEqual([requestId, 2, organizationId, null, 'NORTH']);
    expect(calls.some(({ sql }) => sql.includes('INSERT INTO stock_movement'))).toBe(false);
    expect(idempotency.execute).toHaveBeenCalledTimes(1);
  });

  it('does not open a Logistics transaction when Response rejects admission', async () => {
    const { service, idempotency, response } = setup({ admissionError: new AppError('REQUEST_NOT_VERIFIED', { status: 409 }) });

    await expect(service.create(dto, request)).rejects.toMatchObject({ code: 'REQUEST_NOT_VERIFIED', status: 409 });

    expect(response.admit).toHaveBeenCalledTimes(1);
    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('requires a live request-scoped NEED_MANAGE grant before opening the local transaction', async () => {
    const { service, idempotency } = setup({ grants: [{
      role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: '88888888-8888-4888-8888-888888888888',
    }] });

    await expect(service.create(dto, request)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });

    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('rejects an invalid idempotency key before admitting the request in Response', async () => {
    const { service, response, idempotency } = setup();

    await expect(service.create(dto, { idempotencyKey: 'not-a-uuid' } as Request & { idempotencyKey: string }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_INVALID', status: 400 });

    expect(response.admit).not.toHaveBeenCalled();
    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('locks an existing cycle and rejects a frozen cycle before reading the item', async () => {
    const { service, calls } = setup({ cycleState: 'FROZEN' });

    await expect(service.create(dto, request)).rejects.toMatchObject({ code: 'CYCLE_FROZEN', status: 409 });

    expect(calls.some(({ sql }) => sql.includes('FROM fulfillment_cycle') && sql.includes('FOR UPDATE'))).toBe(true);
    expect(calls.some(({ sql }) => sql.includes('FROM item i JOIN unit u'))).toBe(false);
  });

  it('requires an active relief point in the request organization and scoped need grant', async () => {
    const pointId = '99999999-9999-4999-8999-999999999999';
    const { service, calls } = setup({ point: {
      id: pointId, organization_id: '88888888-8888-4888-8888-888888888888', region_code: 'NORTH', status: 'ACTIVE',
    } });

    await expect(service.create({ ...dto, designated_point_id: pointId, reason: 'Giao tại điểm.' }, request))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(calls.some(({ sql }) => sql.includes('INSERT INTO relief_need'))).toBe(false);
  });

  it('requires a scoped grant for the relief point region', async () => {
    const pointId = '99999999-9999-4999-8999-999999999999';
    const { service, calls } = setup({
      point: { id: pointId, organization_id: organizationId, region_code: 'SOUTH', status: 'ACTIVE' },
      grants: [{ role_code: 'COORDINATOR', scope_type: 'REGION', organization_id: organizationId, region_code: 'NORTH' }],
    });

    await expect(service.create({ ...dto, designated_point_id: pointId, reason: 'Giao tại điểm.' }, request))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(calls.some(({ sql }) => sql.includes('INSERT INTO relief_need'))).toBe(false);
  });

  it('requires a reason and does not accept FINAL_RECIPIENT with a designated point', async () => {
    const pointId = '99999999-9999-4999-8999-999999999999';
    const { service, response } = setup();

    await expect(service.create({ ...dto, designated_point_id: pointId }, request))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(response.admit).not.toHaveBeenCalled();
    await expect(service.create({ ...dto, delivery_target_kind: 'FINAL_RECIPIENT', designated_point_id: pointId, reason: 'Giao tại điểm.' }, request))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
  });
});
