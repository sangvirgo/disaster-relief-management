import { jest } from '@jest/globals';
import type { DataSource, EntityManager } from 'typeorm';
import type { Request } from 'express';
import type { Grant } from '@c48/identity-contracts/permissions';
import type { LogisticsSessionService } from '../src/auth/logistics-session.service';
import { NeedNormsService } from '../src/needs/need-norms.service';
import type { NeedNormPatchDto } from '../src/needs/needs.dto';

const normId = '10000000-0000-4000-8000-0000000000aa';
const waterItemId = '44444444-4444-4444-8444-444444444444';
const otherTypeItemId = '45454545-4545-4545-8545-454545454545';
const sameTypeItemId = '46464646-4646-4646-8646-464646464646';
const managerGrant: Grant = { role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' };
const coordinatorGrant: Grant = { role_code: 'COORDINATOR', scope_type: 'SYSTEM' };

function norm(overrides: Record<string, unknown> = {}) {
  return {
    id: normId, category: 'WATER', item_type_code: 'NUOC_UONG', quantity_basis: 'BY_GROUP',
    qty_adult: '3.000', qty_child: '1.000', qty_elderly: '2.000', people_per_unit: null, fixed_quantity: null,
    default_item_id: waterItemId, in_default_bundle: true, active: true, version: 2, updated_at: new Date('2026-11-18T00:00:00.000Z'),
    ...overrides,
  };
}

function setup(options: { current?: Record<string, unknown>; grants?: Grant[]; items?: Record<string, { status: string; item_type_code: string }> } = {}) {
  const statements: Array<{ sql: string; values?: unknown[] }> = [];
  const current = options.current ?? norm();
  const items = options.items ?? {
    [waterItemId]: { status: 'ACTIVE', item_type_code: 'NUOC_UONG' },
    [otherTypeItemId]: { status: 'ACTIVE', item_type_code: 'LUONG_THUC' },
    [sameTypeItemId]: { status: 'ACTIVE', item_type_code: 'NUOC_UONG' },
  };
  const manager = {
    query: jest.fn(async (sql: string, values?: unknown[]) => {
      statements.push({ sql, values });
      if (sql.includes('FROM need_norm') && sql.includes('FOR UPDATE')) return [current];
      if (sql.includes('FROM item WHERE id=$1')) {
        const item = items[String(values?.[0])];
        return item ? [item] : [];
      }
      if (sql.startsWith('UPDATE need_norm')) return [{ id: normId }];
      if (sql.includes('FROM need_norm WHERE id=$1')) return [norm({ ...current, version: Number(current.version) + 1 })];
      if (sql.includes('INSERT INTO audit_log')) return [];
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  } as unknown as EntityManager;
  const dataSource = {
    query: jest.fn(async () => []),
    transaction: jest.fn(async (run: (m: EntityManager) => Promise<unknown>) => run(manager)),
  };
  const sessions = { require: jest.fn(async () => ({ userId: 'actor', grants: options.grants ?? [managerGrant] })) };
  const service = new NeedNormsService(dataSource as unknown as DataSource, sessions as unknown as LogisticsSessionService);
  const update = (dto: Partial<NeedNormPatchDto> & { expected_version: number }) =>
    service.update(normId, dto as NeedNormPatchDto, {} as Request);
  return { service, statements, update, manager };
}

function updateValues(statements: Array<{ sql: string; values?: unknown[] }>): unknown[] | undefined {
  return statements.find((statement) => statement.sql.startsWith('UPDATE need_norm'))?.values;
}

describe('NeedNormsService.update', () => {
  it('lets only the operations manager change norms', async () => {
    const { update } = setup({ grants: [coordinatorGrant] });
    await expect(update({ expected_version: 2, qty_adult: '4.000' })).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });

  it('requires at least one change', async () => {
    const { update } = setup();
    await expect(update({ expected_version: 2 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
  });

  it('refuses a stale version with VERSION_CONFLICT', async () => {
    const { update } = setup();
    await expect(update({ expected_version: 1, qty_adult: '4.000' })).rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
  });

  it('updates the group quantities of a BY_GROUP norm and keeps the other fields cleared', async () => {
    const { update, statements } = setup();
    await update({ expected_version: 2, qty_adult: '4.000' });
    expect(updateValues(statements)).toEqual([normId, 2, 'BY_GROUP', '4.000', '1.000', '2.000', null, null, waterItemId, null, null]);
  });

  it('switches to PER_N_PEOPLE with people_per_unit and zeroes the group quantities', async () => {
    const { update, statements } = setup();
    await update({ expected_version: 2, quantity_basis: 'PER_N_PEOPLE', people_per_unit: 2 });
    expect(updateValues(statements)).toEqual([normId, 2, 'PER_N_PEOPLE', '0', '0', '0', 2, null, waterItemId, null, null]);
  });

  it('refuses PER_N_PEOPLE without people_per_unit', async () => {
    const { update } = setup();
    await expect(update({ expected_version: 2, quantity_basis: 'PER_N_PEOPLE' })).rejects.toMatchObject({ code: 'NEED_NORM_SHAPE_INVALID', status: 400 });
  });

  it('refuses a group quantity on a PER_N_PEOPLE norm', async () => {
    const { update } = setup({ current: norm({ quantity_basis: 'PER_N_PEOPLE', qty_adult: '0.000', qty_child: '0.000', qty_elderly: '0.000', people_per_unit: 2 }) });
    await expect(update({ expected_version: 2, qty_adult: '1.000' })).rejects.toMatchObject({ code: 'NEED_NORM_SHAPE_INVALID', status: 400 });
  });

  it('refuses BY_GROUP with every group quantity at zero', async () => {
    const { update } = setup();
    await expect(update({ expected_version: 2, qty_adult: '0', qty_child: '0', qty_elderly: '0' })).rejects.toMatchObject({ code: 'NEED_NORM_SHAPE_INVALID', status: 400 });
  });

  it('switches to PER_REQUEST only with a positive fixed quantity', async () => {
    const { update, statements } = setup();
    await update({ expected_version: 2, quantity_basis: 'PER_REQUEST', fixed_quantity: '1.000' });
    expect(updateValues(statements)).toEqual([normId, 2, 'PER_REQUEST', '0', '0', '0', null, '1.000', waterItemId, null, null]);
    await expect(update({ expected_version: 2, quantity_basis: 'PER_REQUEST', fixed_quantity: '0' })).rejects.toMatchObject({ code: 'NEED_NORM_SHAPE_INVALID' });
  });

  it('accepts an ACTIVE default item of the norm item type', async () => {
    const { update, statements } = setup();
    await update({ expected_version: 2, default_item_id: sameTypeItemId });
    expect(updateValues(statements)?.[8]).toBe(sameTypeItemId);
  });

  it('refuses a default item of another item type with NEED_DEFAULT_ITEM_INVALID', async () => {
    const { update } = setup();
    await expect(update({ expected_version: 2, default_item_id: otherTypeItemId })).rejects.toMatchObject({ code: 'NEED_DEFAULT_ITEM_INVALID', status: 400 });
  });

  it('refuses an inactive or unknown default item with NEED_DEFAULT_ITEM_INVALID', async () => {
    const inactive = setup({ items: { [waterItemId]: { status: 'INACTIVE', item_type_code: 'NUOC_UONG' } } });
    await expect(inactive.update({ expected_version: 2, default_item_id: waterItemId })).rejects.toMatchObject({ code: 'NEED_DEFAULT_ITEM_INVALID' });
    const unknown = setup({ items: {} });
    await expect(unknown.update({ expected_version: 2, default_item_id: waterItemId })).rejects.toMatchObject({ code: 'NEED_DEFAULT_ITEM_INVALID' });
  });

  it('clears the default item when null is sent', async () => {
    const { update, statements } = setup();
    await update({ expected_version: 2, default_item_id: null });
    expect(updateValues(statements)?.[8]).toBeNull();
  });

  it('writes an audit row with the before and after state', async () => {
    const { update, statements } = setup();
    await update({ expected_version: 2, active: false });
    const audit = statements.find((statement) => statement.sql.includes('INSERT INTO audit_log'));
    expect(audit?.values?.[0]).toBe('actor');
    expect(audit?.values?.[1]).toBe(normId);
  });
});
