import { describe, expect, it, jest } from '@jest/globals';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import type { Grant } from '@c48/identity-contracts/permissions';
import type { LogisticsSessionService } from '../src/auth/logistics-session.service';
import { NeedProposalsService } from '../src/need-extraction/need-proposals.service';
import { needReasonText } from '../src/needs/need-reasons';

const cycleId = '33333333-3333-4333-8333-333333333333';
const requestId = '11111111-1111-4111-8111-111111111111';
const campaignId = '55555555-5555-4555-8555-555555555555';
const warehouseId = '66666666-6666-4666-8666-666666666666';
const waterId = '44444444-4444-4444-8444-444444444444';
const riceId = '45454545-4545-4545-8545-454545454545';

const estimateBasis = {
  batch_id: 'batch-1',
  category: 'WATER',
  item_id: waterId,
  reason_codes: ['NORM_BY_GROUP', 'DEFAULT_ITEM_USED'],
  inputs: { people: 5, children: 1, elderly: 1, adults: 3, qty_adult: '3.000', qty_child: '1.000', qty_elderly: '2.000', people_per_unit: null, fixed_quantity: null, raw_quantity: '12.000' },
  extraction: {
    source: 'ALIAS',
    reason_codes: ['ALIAS_MATCHED', 'UNMATCHED_TERMS'],
    unmatched_terms: ['pin'],
    mentioned_items: [{ item_id: waterId, category: 'WATER' }, { item_id: riceId, category: 'FOOD' }],
  },
};

function line(id: string, itemId: string, quantity: string, overrides: Record<string, unknown> = {}) {
  return {
    id, version: 1, cycle_id: cycleId, item_id: itemId, item_name: itemId === waterId ? 'Nước uống' : 'Gạo',
    unit_code: 'L', unit_name: 'Lít', unit_scale: 3, requested_quantity: quantity,
    estimate_basis: { ...estimateBasis, item_id: itemId, category: itemId === waterId ? 'WATER' : 'FOOD' },
    status: 'OPEN', ...overrides,
  };
}

function setup(grants: Grant[], rows: { cycles?: unknown[]; lines?: unknown[]; primaries?: unknown[]; stock?: unknown[]; unassigned?: number } = {}) {
  const sqls: string[] = [];
  const query = jest.fn(async (sql: string, _values: unknown[] = []): Promise<unknown[]> => {
    sqls.push(sql);
    if (sql.includes('FROM fulfillment_cycle AS unassigned')) return [{ total: rows.unassigned ?? 0 }];
    if (sql.includes('FROM fulfillment_cycle c')) return rows.cycles ?? [];
    if (sql.includes('FROM relief_need n JOIN item i')) return rows.lines ?? [];
    if (sql.includes('FROM campaign_warehouse')) return rows.primaries ?? [];
    if (sql.includes('FROM stock_balance')) return rows.stock ?? [];
    if (sql.includes('SELECT id,name FROM item')) return [{ id: waterId, name: 'Nước uống' }, { id: riceId, name: 'Gạo' }];
    throw new Error(`Unexpected SQL: ${sql.slice(0, 80)}`);
  });
  const sessions = { require: jest.fn(async () => ({ userId: 'manager', grants })) };
  const service = new NeedProposalsService({ query } as unknown as DataSource, sessions as unknown as LogisticsSessionService);
  return { service, query, sqls };
}

const request = {} as Request;
const cycle = { cycle_id: cycleId, request_id: requestId, work_cycle: 1, campaign_id: campaignId };

describe('NeedProposalsService', () => {
  it('refuses a caller without NEED_ESTIMATE_CONFIRM in any scope', async () => {
    const { service } = setup([{ role_code: 'COORDINATOR', scope_type: 'SYSTEM' }]);
    await expect(service.list({}, request)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('a campaign-scoped manager sees only that campaign, and the SQL is read-only', async () => {
    const { service, sqls } = setup([{ role_code: 'OPERATIONS_MANAGER', scope_type: 'CAMPAIGN', campaign_id: campaignId }], { cycles: [] });
    await service.list({}, request);
    expect(sqls[0]).toContain('c.campaign_id=ANY($1::uuid[])');
    for (const sql of sqls) expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/u);
  });

  it('a system manager sees every campaign, but not proposals of SOS outside campaigns', async () => {
    const { service, sqls } = setup([{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }], { cycles: [] });
    await service.list({}, request);
    expect(sqls[0]).not.toContain('c.campaign_id=ANY');
    expect(sqls[0]).toContain('c.campaign_id IS NOT NULL');
  });

  it('lists proposals outside every campaign apart and reports their count', async () => {
    const { service, sqls } = setup([{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }], { cycles: [], unassigned: 3 });
    const result = await service.list({ campaign_scope: 'NONE' }, request);
    expect(sqls[0]).toContain('c.campaign_id IS NULL');
    expect(result.unassigned_total).toBe(3);
  });

  it('keeps the unassigned list and count away from a campaign-scoped manager', async () => {
    const { service } = setup([{ role_code: 'OPERATIONS_MANAGER', scope_type: 'CAMPAIGN', campaign_id: campaignId }], { cycles: [] });
    await expect(service.list({ campaign_scope: 'NONE' }, request)).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    const result = await service.list({}, request);
    expect(result).not.toHaveProperty('unassigned_total');
  });

  it('flags a line whose quantity exceeds the free stock of the campaign PRIMARY warehouse', async () => {
    const { service } = setup([{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }], {
      cycles: [cycle],
      lines: [line('need-1', waterId, '12.000'), line('need-2', riceId, '2.000')],
      primaries: [{ campaign_id: campaignId, warehouse_id: warehouseId }],
      stock: [
        { warehouse_id: warehouseId, item_id: waterId, on_hand: '10.000', reserved: '4.000' },
        { warehouse_id: warehouseId, item_id: riceId, on_hand: '5.000', reserved: '0.000' },
      ],
    });
    const result = await service.list({}, request);
    const [item] = result.items as Array<{ lines: Array<Record<string, unknown>>; warehouse: unknown; sos: unknown }>;
    expect(item!.warehouse).toEqual({ id: warehouseId });
    expect(item!.lines).toEqual([
      expect.objectContaining({ need_id: 'need-1', quantity: '12.000', available: '6.000', shortfall: true }),
      expect.objectContaining({ need_id: 'need-2', quantity: '2.000', available: '5.000', shortfall: false }),
    ]);
    expect(item!.sos).toEqual({ people: 5, children: 1, elderly: 1, adults: 3 });
  });

  it('leaves warehouse and shortfall null when the campaign has no PRIMARY warehouse', async () => {
    const { service } = setup([{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }], {
      cycles: [cycle], lines: [line('need-1', waterId, '3.000')],
    });
    const result = await service.list({}, request);
    const [item] = result.items as Array<{ warehouse: unknown; lines: Array<Record<string, unknown>> }>;
    expect(item!.warehouse).toBeNull();
    expect(item!.lines[0]).toMatchObject({ available: null, shortfall: null });
  });

  it('returns the extraction summary with Vietnamese reason copy and item names, never a quantity field', async () => {
    const { service } = setup([{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }], {
      cycles: [cycle], lines: [line('need-1', waterId, '12.000')],
    });
    const result = await service.list({}, request);
    const [item] = result.items as Array<{ lines: Array<{ reasons: Array<{ code: string; message: string }> }>; extraction: Record<string, unknown> }>;
    expect(item!.lines[0]!.reasons.map((reason) => reason.code)).toEqual(['NORM_BY_GROUP', 'DEFAULT_ITEM_USED']);
    expect(item!.lines[0]!.reasons[0]!.message).toBe(needReasonText('NORM_BY_GROUP'));
    expect(needReasonText('NORM_BY_GROUP')).toMatch(/[\u00C0-\u1EF9]/u);
    expect(item!.extraction).toMatchObject({
      source: 'ALIAS',
      unmatched_terms: ['pin'],
      mentioned_items: [
        { item_id: waterId, item_name: 'Nước uống', category: 'WATER' },
        { item_id: riceId, item_name: 'Gạo', category: 'FOOD' },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/"quantity_units"|"suggested_quantity"/u);
  });

  it('pages by cycle id with a keyset cursor', async () => {
    const { service } = setup([{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }], { cycles: [cycle, { ...cycle, cycle_id: '99999999-9999-4999-8999-999999999999' }] });
    const result = await service.list({ limit: 1 }, request);
    expect(result.more).toBe(true);
    expect(typeof result.cursor).toBe('string');
    expect((result.items as unknown[]).length).toBe(1);
  });
});
