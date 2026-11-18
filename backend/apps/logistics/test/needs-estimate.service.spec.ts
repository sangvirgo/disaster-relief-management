import { jest } from '@jest/globals';
import type { DataSource, EntityManager } from 'typeorm';
import type { Grant } from '@c48/identity-contracts/permissions';
import type { IdempotencyService } from '@c48/technical/idempotency/idempotency';
import type { LogisticsSessionService } from '../src/auth/logistics-session.service';
import { NeedsService } from '../src/needs/needs.service';
import type { EstimateNeedsDto } from '../src/needs/needs.dto';
import type { NeedCommandRequest } from '../src/needs/needs.helpers';
import type { ResponseAdmissionClient } from '../src/needs/response-admission.client';

const requestId = '11111111-1111-4111-8111-111111111111';
const cycleId = '33333333-3333-4333-8333-333333333333';
const waterItemId = '44444444-4444-4444-8444-444444444444';
const riceItemId = '45454545-4545-4545-8545-454545454545';
const actorId = '66666666-6666-4666-8666-666666666666';
const norms = [
  {
    id: '10000000-0000-4000-8000-000000000001', category: 'WATER', item_type_code: 'NUOC_UONG', quantity_basis: 'PER_PERSON_DAY',
    qty_per_person_per_day: '3.000', modifier_infant: '0.00', modifier_elderly: '0.00', active: true, version: 1,
  },
  {
    id: '10000000-0000-4000-8000-000000000002', category: 'FOOD', item_type_code: 'LUONG_THUC', quantity_basis: 'PER_PERSON_DAY',
    qty_per_person_per_day: '0.600', modifier_infant: '0.00', modifier_elderly: '0.00', active: true, version: 1,
  },
];

const coordinatorGrant: Grant = { role_code: 'COORDINATOR', scope_type: 'SYSTEM' };
const admission = { request_id: requestId, work_cycle: 1, version: 3, status: 'TRIAGED', campaign_id: null };

const dto: EstimateNeedsDto = {
  request_id: requestId,
  work_cycle: 1,
  people_count: 10,
  days: 3,
  categories: [{ category: 'WATER', item_id: waterItemId }],
};

function setup(options: {
  items?: Record<string, { item_type_code: string; scale: number }>;
  declared?: boolean;
  norms?: typeof norms;
  dto?: Partial<EstimateNeedsDto>;
} = {}) {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const inserted: Array<{ id: string; values: unknown[] }> = [];
  const items = options.items ?? {
    [waterItemId]: { item_type_code: 'NUOC_UONG', scale: 3 },
    [riceItemId]: { item_type_code: 'LUONG_THUC', scale: 3 },
  };
  const cycle = { id: cycleId, request_id: requestId, work_cycle: 1, campaign_id: null, state: 'OPEN' };
  const manager = {
    query: jest.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.includes('INSERT INTO fulfillment_cycle')) return [];
      if (sql.includes('FROM fulfillment_cycle') && sql.includes('FOR UPDATE')) return [cycle];
      if (sql.includes('FROM item i JOIN unit u')) {
        const id = String(values?.[0]);
        const item = items[id];
        return item ? [{ id, status: 'ACTIVE', item_type_code: item.item_type_code, scale: item.scale }] : [];
      }
      if (sql.includes('FROM need_norm')) {
        const category = String(values?.[0]);
        return (options.norms ?? norms).filter((norm) => norm.category === category && norm.active);
      }
      if (sql.includes('n.source IN')) return options.declared ? [{ id: 'declared-need' }] : [];
      if (sql.includes('INSERT INTO relief_need')) {
        const id = `need-${inserted.length + 1}`;
        inserted.push({ id, values: values ?? [] });
        return [{ id }];
      }
      if (sql.includes('FROM relief_need n JOIN fulfillment_cycle')) {
        const id = String(values?.[0]);
        return [{
          id, cycle_id: cycleId, request_id: requestId, work_cycle: 1, campaign_id: null, item_id: waterItemId,
          item_name: 'Nước', unit_code: 'L', unit_name: 'Lít', unit_scale: 3, original_quantity: '90.000',
          requested_quantity: '90.000', cancelled_remaining: null, designated_point_id: null, status: 'OPEN',
          source: 'ESTIMATED', estimate_basis: null, version: 1, created_at: new Date('2026-11-18T00:00:00.000Z'),
        }];
      }
      if (sql.includes('INSERT INTO audit_log')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  } as unknown as EntityManager;
  const dataSource = { transaction: jest.fn(async (run: (m: EntityManager) => Promise<unknown>) => run(manager)) };
  const idempotency = {
    execute: jest.fn(async (_source: unknown, command: {
      execute(m: EntityManager): Promise<{ status: number; value: Record<string, unknown> }>;
    }) => ({ ...(await command.execute(manager)), replay: false })),
  };
  const sessions = {
    require: jest.fn(async () => ({ userId: actorId, grants: [coordinatorGrant], identityHeaders: {} })),
  };
  const response = { admit: jest.fn(async () => admission) };
  const service = new NeedsService(
    dataSource as unknown as DataSource,
    idempotency as unknown as IdempotencyService,
    sessions as unknown as LogisticsSessionService,
    response as unknown as ResponseAdmissionClient,
  );
  const request = { idempotencyKey: '77777777-7777-4777-8777-777777777777' } as NeedCommandRequest;
  return { service, calls, inserted, request, idempotency, dto: { ...dto, ...options.dto } };
}

describe('NeedsService.estimate', () => {
  it('creates one ESTIMATED need per category with its basis and returns the batch', async () => {
    const { service, inserted, calls, request, dto: input } = setup({
      dto: { categories: [{ category: 'WATER', item_id: waterItemId }, { category: 'FOOD', item_id: riceItemId }] },
    });

    const result = await service.estimate(input, request);

    expect(result.status).toBe(201);
    const items = (result.value as { items: Array<Record<string, unknown>> }).items;
    expect(items).toHaveLength(2);
    expect(inserted).toHaveLength(2);
    const insertSql = calls.find((call) => call.sql.includes('INSERT INTO relief_need'))?.sql ?? '';
    expect(insertSql).toContain("'ESTIMATED'");
    const basis = JSON.parse(String(inserted[0]!.values[3])) as Record<string, unknown>;
    expect(basis).toMatchObject({
      category: 'WATER', item_type_code: 'NUOC_UONG', norm_id: norms[0]!.id, people_count: 10, days: 3,
      estimated_quantity: '90.000', reason_codes: ['NORM_PER_PERSON_DAY'],
    });
    expect(typeof basis.batch_id).toBe('string');
    expect(inserted[0]!.values[1]).toBe(waterItemId);
    expect(inserted[0]!.values[2]).toBe('90.000');
  });

  it('defaults the horizon to three days when the caller omits it', async () => {
    const { service, inserted, request, dto: input } = setup({ dto: { days: undefined } });

    await service.estimate(input, request);

    const basis = JSON.parse(String(inserted[0]!.values[3])) as Record<string, unknown>;
    expect(basis).toMatchObject({ days: 3, estimated_quantity: '90.000', reason_codes: ['NORM_PER_PERSON_DAY', 'DAYS_DEFAULT'] });
  });

  it('refuses when the request already has a declared or confirmed need for the item', async () => {
    const { service, inserted, request, dto: input } = setup({ declared: true });

    await expect(service.estimate(input, request)).rejects.toMatchObject({ code: 'NEED_ALREADY_DECLARED', status: 409 });
    expect(inserted).toHaveLength(0);
  });

  it('refuses a category that has no active norm', async () => {
    const { service, request, dto: input } = setup({ dto: { categories: [{ category: 'FUEL', item_id: waterItemId }] } });

    await expect(service.estimate(input, request)).rejects.toMatchObject({ code: 'NEED_NORM_NOT_FOUND', status: 400 });
  });

  it('refuses an item whose type does not match the norm for its category', async () => {
    const { service, request, dto: input } = setup({ dto: { categories: [{ category: 'WATER', item_id: riceItemId }] } });

    await expect(service.estimate(input, request)).rejects.toMatchObject({ code: 'NEED_ITEM_TYPE_MISMATCH', status: 400 });
  });

  it('refuses the same category twice', async () => {
    const { service, request, dto: input } = setup({
      dto: { categories: [{ category: 'WATER', item_id: waterItemId }, { category: 'WATER', item_id: waterItemId }] },
    });

    await expect(service.estimate(input, request)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
  });
});
