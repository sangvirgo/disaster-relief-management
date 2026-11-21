import { jest } from '@jest/globals';
import type { DataSource, EntityManager } from 'typeorm';
import type { Grant } from '@c48/identity-contracts/permissions';
import type { IdempotencyService } from '@c48/technical/idempotency/idempotency';
import type { LogisticsSessionService } from '../src/auth/logistics-session.service';
import { NeedsService } from '../src/needs/needs.service';
import type { EstimateNeedsDto } from '../src/needs/needs.dto';
import type { NeedCommandRequest } from '../src/needs/needs.helpers';
import type { ResponseAdmission, ResponseAdmissionClient } from '../src/needs/response-admission.client';

const requestId = '11111111-1111-4111-8111-111111111111';
const cycleId = '33333333-3333-4333-8333-333333333333';
const waterItemId = '44444444-4444-4444-8444-444444444444';
const riceItemId = '45454545-4545-4545-8545-454545454545';
const blanketItemId = '46464646-4646-4646-8646-464646464646';
const actorId = '66666666-6666-4666-8666-666666666666';

const norms = [
  {
    id: '10000000-0000-4000-8000-000000000001', category: 'WATER', item_type_code: 'NUOC_UONG', quantity_basis: 'BY_GROUP',
    qty_adult: '3.000', qty_child: '1.000', qty_elderly: '2.000', people_per_unit: null, fixed_quantity: null,
    default_item_id: waterItemId, in_default_bundle: true, active: true, version: 1,
  },
  {
    id: '10000000-0000-4000-8000-000000000002', category: 'FOOD', item_type_code: 'LUONG_THUC', quantity_basis: 'BY_GROUP',
    qty_adult: '2.000', qty_child: '1.000', qty_elderly: '1.000', people_per_unit: null, fixed_quantity: null,
    default_item_id: riceItemId, in_default_bundle: true, active: true, version: 1,
  },
  {
    id: '10000000-0000-4000-8000-000000000003', category: 'BLANKET', item_type_code: 'CHAN_MEN', quantity_basis: 'PER_N_PEOPLE',
    qty_adult: '0.000', qty_child: '0.000', qty_elderly: '0.000', people_per_unit: 2, fixed_quantity: null,
    default_item_id: blanketItemId, in_default_bundle: false, active: true, version: 1,
  },
];

const coordinatorGrant: Grant = { role_code: 'COORDINATOR', scope_type: 'SYSTEM' };
const managerGrant: Grant = { role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' };

const verifiedAdmission: ResponseAdmission = {
  request_id: requestId,
  work_cycle: 1,
  version: 3,
  status: 'TRIAGED',
  campaign_id: null,
  people_affected: 10,
  children_count: 3,
  elderly_count: 2,
  needs_relief_supplies: true,
};

const baseDto: EstimateNeedsDto = { request_id: requestId, work_cycle: 1 };

function setup(options: {
  declared?: boolean;
  admission?: Partial<ResponseAdmission>;
  grants?: Grant[];
  norms?: typeof norms;
  dto?: Partial<EstimateNeedsDto>;
} = {}) {
  const inserted: Array<{ id: string; values: unknown[] }> = [];
  const items: Record<string, { item_type_code: string; scale: number }> = {
    [waterItemId]: { item_type_code: 'NUOC_UONG', scale: 3 },
    [riceItemId]: { item_type_code: 'LUONG_THUC', scale: 3 },
    [blanketItemId]: { item_type_code: 'CHAN_MEN', scale: 0 },
  };
  const cycle = { id: cycleId, request_id: requestId, work_cycle: 1, campaign_id: null, state: 'OPEN' };
  const manager = {
    query: jest.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes('INSERT INTO fulfillment_cycle')) return [];
      if (sql.includes('FROM fulfillment_cycle') && sql.includes('FOR UPDATE')) return [cycle];
      if (sql.includes('FROM need_norm')) return options.norms ?? norms;
      if (sql.includes('WHERE i.id=ANY')) {
        const ids = (values?.[0] ?? []) as string[];
        return ids.filter((id) => items[id]).map((id) => ({
          id, status: 'ACTIVE', item_type_code: items[id]!.item_type_code, scale: items[id]!.scale,
        }));
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
          item_name: 'Nước', unit_code: 'LIT', unit_name: 'Lít', unit_scale: 3, original_quantity: '30.000',
          requested_quantity: '30.000', cancelled_remaining: null, status: 'OPEN',
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
    require: jest.fn(async () => ({ userId: actorId, grants: options.grants ?? [managerGrant], identityHeaders: {} })),
  };
  const response = { admit: jest.fn(async () => ({ ...verifiedAdmission, ...options.admission })) };
  const service = new NeedsService(
    dataSource as unknown as DataSource,
    idempotency as unknown as IdempotencyService,
    sessions as unknown as LogisticsSessionService,
    response as unknown as ResponseAdmissionClient,
  );
  const request = { idempotencyKey: '77777777-7777-4777-8777-777777777777' } as NeedCommandRequest;
  return { service, inserted, request, dto: { ...baseDto, ...options.dto } };
}

function basisOf(inserted: Array<{ values: unknown[] }>, index: number): Record<string, unknown> {
  return JSON.parse(String(inserted[index]!.values[3])) as Record<string, unknown>;
}

describe('NeedsService.estimate', () => {
  it('reads the SOS facts from admission and creates one ESTIMATED need per category with its basis', async () => {
    const { service, inserted, request, dto } = setup({
      dto: { categories: [{ category: 'WATER' }, { category: 'FOOD', item_id: riceItemId }] },
    });

    const result = await service.estimate(dto, request);

    expect(result.status).toBe(201);
    expect((result.value as { items: unknown[] }).items).toHaveLength(2);
    expect(inserted).toHaveLength(2);
    // WATER: 5 adults * 3 + 3 children * 1 + 2 elderly * 2 = 22 (default item, scale 3)
    expect(inserted[0]!.values[1]).toBe(waterItemId);
    expect(inserted[0]!.values[2]).toBe('22.000');
    expect(basisOf(inserted, 0)).toMatchObject({
      category: 'WATER', item_type_code: 'NUOC_UONG', item_id: waterItemId, norm_id: norms[0]!.id,
      basis: 'BY_GROUP', estimated_quantity: '22.000', reason_codes: ['NORM_BY_GROUP', 'DEFAULT_ITEM_USED'],
      inputs: { people: 10, children: 3, elderly: 2, adults: 5 },
    });
    expect(typeof basisOf(inserted, 0).batch_id).toBe('string');
    // FOOD with the explicit rice item: 5 * 2 + 3 * 1 + 2 * 1 = 15
    expect(inserted[1]!.values[1]).toBe(riceItemId);
    expect(basisOf(inserted, 1).reason_codes).toEqual(['NORM_BY_GROUP']);
  });

  it('uses every active norm marked in_default_bundle when categories are omitted', async () => {
    const { service, inserted, request, dto } = setup({ dto: { categories: undefined } });

    await service.estimate(dto, request);

    expect(inserted.map((row) => row.values[1])).toEqual([waterItemId, riceItemId]);
    expect(basisOf(inserted, 0)).toMatchObject({ category: 'WATER' });
    expect(basisOf(inserted, 1)).toMatchObject({ category: 'FOOD' });
  });

  it('estimates a per-N-people category at its default item', async () => {
    const { service, inserted, request, dto } = setup({ dto: { categories: [{ category: 'BLANKET' }] } });

    await service.estimate(dto, request);

    expect(inserted[0]!.values[1]).toBe(blanketItemId);
    expect(inserted[0]!.values[2]).toBe('5');
    expect(basisOf(inserted, 0)).toMatchObject({ basis: 'PER_N_PEOPLE', estimated_quantity: '5', reason_codes: ['NORM_PER_N_PEOPLE', 'DEFAULT_ITEM_USED'] });
  });

  it('refuses a request that does not need relief supplies', async () => {
    const { service, inserted, request, dto } = setup({ admission: { needs_relief_supplies: false } });

    await expect(service.estimate(dto, request)).rejects.toMatchObject({ code: 'NEED_RELIEF_NOT_REQUESTED', status: 409 });
    expect(inserted).toHaveLength(0);
  });

  it('refuses an SOS with no people count', async () => {
    const { service, inserted, request, dto } = setup({ admission: { people_affected: null } });

    await expect(service.estimate(dto, request)).rejects.toMatchObject({ code: 'NEED_PEOPLE_MISSING', status: 409 });
    expect(inserted).toHaveLength(0);
  });

  it('lets only the operations manager generate estimates', async () => {
    const { service, inserted, request, dto } = setup({ grants: [coordinatorGrant] });

    await expect(service.estimate(dto, request)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(inserted).toHaveLength(0);
  });

  it('refuses when the request already has a declared or confirmed need for the item', async () => {
    const { service, inserted, request, dto } = setup({ declared: true });

    await expect(service.estimate(dto, request)).rejects.toMatchObject({ code: 'NEED_ALREADY_DECLARED', status: 409 });
    expect(inserted).toHaveLength(0);
  });

  it('refuses an explicit category that has no active norm', async () => {
    const { service, request, dto } = setup({ dto: { categories: [{ category: 'FUEL', item_id: waterItemId }] } });

    await expect(service.estimate(dto, request)).rejects.toMatchObject({ code: 'NEED_NORM_NOT_FOUND', status: 400 });
  });

  it('refuses an item whose type does not match the norm for its category', async () => {
    const { service, request, dto } = setup({ dto: { categories: [{ category: 'WATER', item_id: riceItemId }] } });

    await expect(service.estimate(dto, request)).rejects.toMatchObject({ code: 'NEED_ITEM_TYPE_MISMATCH', status: 400 });
  });

  it('fails with NEED_ITEM_REQUIRED when a category has no item and its norm has no default', async () => {
    const withoutDefault = norms.map((norm) => (norm.category === 'WATER' ? { ...norm, default_item_id: null } : norm));
    const { service, request, dto } = setup({ norms: withoutDefault, dto: { categories: [{ category: 'WATER' }] } });

    await expect(service.estimate(dto, request)).rejects.toMatchObject({ code: 'NEED_ITEM_REQUIRED', status: 400 });
  });

  it('refuses the same category twice', async () => {
    const { service, request, dto } = setup({
      dto: { categories: [{ category: 'WATER' }, { category: 'WATER' }] },
    });

    await expect(service.estimate(dto, request)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
  });
});
