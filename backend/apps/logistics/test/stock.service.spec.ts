import { jest } from '@jest/globals';
import { StockService } from '../src/stock/stock.service';

const actorId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const warehouseId = '33333333-3333-4333-8333-333333333333';
const balanceId = '44444444-4444-4444-8444-444444444444';
const adjustmentId = '55555555-5555-4555-8555-555555555555';

function request() {
  return {
    method: 'POST',
    headers: {},
    idempotencyKey: '66666666-6666-4666-8666-666666666666',
  } as never;
}

describe('Logistics stock command scope', () => {
  it('rejects an out-of-scope balance before claiming idempotency', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([{
      id: balanceId,
      warehouse_id: warehouseId,
      organization_id: '77777777-7777-4777-8777-777777777777',
      region_code: 'R02',
      scale: 2,
    }]) };
    const idempotency = { execute: jest.fn() };
    const sessions = { require: jest.fn().mockResolvedValue({
      userId: actorId,
      grants: [{ role_code: 'INTAKE_STAFF', scope_type: 'REGION', organization_id: organizationId, region_code: 'R01' }],
    }) };
    const service = new StockService(dataSource as never, idempotency as never, sessions as never);

    await expect(service.createAdjustment({ balance_id: balanceId, delta_on_hand: '-1.00', reason: 'Kiểm kê lệch' }, request()))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('refuses a requester as reviewer before opening the review transaction', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([{
      id: adjustmentId,
      balance_id: balanceId,
      requested_by_user_id: actorId,
      status: 'PENDING',
      organization_id: organizationId,
      region_code: 'R01',
    }]) };
    const idempotency = { execute: jest.fn() };
    const sessions = { require: jest.fn().mockResolvedValue({
      userId: actorId,
      grants: [{ role_code: 'REVIEWER', scope_type: 'ORGANIZATION', organization_id: organizationId }],
    }) };
    const service = new StockService(dataSource as never, idempotency as never, sessions as never);

    await expect(service.reviewAdjustment(adjustmentId, { decision: 'APPROVE' }, request()))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('rejects opening stock with more than fifty lines before a transaction', async () => {
    const dataSource = { query: jest.fn() };
    const idempotency = { execute: jest.fn() };
    const sessions = { require: jest.fn().mockResolvedValue({
      userId: actorId,
      grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'ORGANIZATION', organization_id: organizationId }],
    }) };
    const service = new StockService(dataSource as never, idempotency as never, sessions as never);
    const lines = Array.from({ length: 51 }, (_, index) => ({
      item_id: `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`, quantity: '1.00',
    }));

    await expect(service.opening({ warehouse_id: warehouseId, lines, note: 'Tồn đầu kỳ' }, request()))
      .rejects.toMatchObject({ code: 'TOO_MANY_LINES' });
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('preinserts opening balances and posts ledger in stable item order', async () => {
    const itemA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const itemB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const balanceA = 'aaaaaaaa-1111-4111-8111-111111111111';
    const balanceB = 'bbbbbbbb-2222-4222-8222-222222222222';
    const dataSource = { query: jest.fn()
      .mockResolvedValueOnce([{ id: warehouseId, organization_id: organizationId, region_code: 'R01', status: 'ACTIVE' }])
      .mockResolvedValueOnce([{ id: itemB, status: 'ACTIVE', scale: 2 }, { id: itemA, status: 'ACTIVE', scale: 2 }]) };
    const idempotency = { execute: jest.fn() };
    const sessions = { require: jest.fn().mockResolvedValue({
      userId: actorId,
      grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'ORGANIZATION', organization_id: organizationId }],
    }) };
    const service = new StockService(dataSource as never, idempotency as never, sessions as never);
    const dto = {
      warehouse_id: warehouseId,
      lines: [{ item_id: itemB, quantity: '2.00' }, { item_id: itemA, quantity: '1.25' }],
      note: 'Tồn đầu kỳ',
    };
    await service.opening(dto, request());
    const command = (idempotency.execute as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[1] as unknown as {
      execute(manager: never): Promise<unknown>;
    };
    const manager = { query: jest.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes('SELECT id,organization_id,region_code,status FROM warehouse')) {
        return [{ id: warehouseId, organization_id: organizationId, region_code: 'R01', status: 'ACTIVE' }];
      }
      if (sql.includes('SELECT i.id,i.status,u.scale')) {
        return [{ id: itemA, status: 'ACTIVE', scale: 2 }, { id: itemB, status: 'ACTIVE', scale: 2 }];
      }
      if (sql.includes('SELECT id,item_id FROM stock_balance')) {
        return [{ id: balanceA, item_id: itemA }, { id: balanceB, item_id: itemB }];
      }
      if (sql.includes('SELECT b.id AS balance_id')) {
        return [
          { balance_id: balanceA, item_id: itemA, on_hand: '1.25', reserved: '0.000', available: '1.25' },
          { balance_id: balanceB, item_id: itemB, on_hand: '2.00', reserved: '0.000', available: '2.00' },
        ];
      }
      return [];
    }) };

    await command.execute(manager as never);
    const itemPreflight = dataSource.query.mock.calls.find(([sql]) => String(sql).includes('SELECT i.id,i.status,u.scale'))?.[0];
    const itemTransactionCheck = manager.query.mock.calls.find(([sql]) => String(sql).includes('SELECT i.id,i.status,u.scale'))?.[0];
    const sqlCalls = manager.query.mock.calls.map(([sql]) => sql);
    const balanceInserts = manager.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO stock_balance'));
    const movementInserts = manager.query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO stock_movement'));
    const balanceRead = sqlCalls.find((sql) => sql.includes('SELECT id,item_id FROM stock_balance'));
    expect(balanceInserts.map(([, values]) => values?.[1])).toEqual([itemA, itemB]);
    expect(balanceRead).toBeDefined();
    expect(balanceRead).not.toContain('FOR UPDATE');
    expect(movementInserts).toHaveLength(2);
    expect(movementInserts.map(([, values]) => values?.[0])).toEqual([balanceA, balanceB]);
    expect(movementInserts.map(([, values]) => values?.[2])).toEqual([
      `OPENING:${actorId}:${(request() as { idempotencyKey: string }).idempotencyKey}:2`,
      `OPENING:${actorId}:${(request() as { idempotencyKey: string }).idempotencyKey}:1`,
    ]);
    expect(itemPreflight).not.toContain('FOR SHARE');
    expect(itemTransactionCheck).toContain('FOR SHARE OF i');
    expect(sqlCalls.some((sql) => /UPDATE\s+stock_balance/iu.test(sql))).toBe(false);
  });

  it('locks the adjustment first and posts the exact ADJ reference as the independent reviewer', async () => {
    const requesterId = '77777777-7777-4777-8777-777777777777';
    const dataSource = { query: jest.fn().mockResolvedValue([{
      id: adjustmentId,
      balance_id: balanceId,
      requested_by_user_id: requesterId,
      status: 'PENDING',
      organization_id: organizationId,
      region_code: 'R01',
    }]) };
    const idempotency = { execute: jest.fn() };
    const sessions = { require: jest.fn().mockResolvedValue({
      userId: actorId,
      grants: [{ role_code: 'REVIEWER', scope_type: 'ORGANIZATION', organization_id: organizationId }],
    }) };
    const service = new StockService(dataSource as never, idempotency as never, sessions as never);
    await service.reviewAdjustment(adjustmentId, { decision: 'APPROVE' }, request());
    const command = (idempotency.execute as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[1] as unknown as {
      execute(manager: never): Promise<unknown>;
    };
    const manager = { query: jest.fn(async (sql: string, _values?: unknown[]) => {
      if (sql.includes('FROM stock_adjustment WHERE id=$1 FOR UPDATE')) return [{
        id: adjustmentId, balance_id: balanceId, requested_by_user_id: requesterId,
        delta_on_hand: '1.250', status: 'PENDING', review_note: null,
      }];
      if (sql.includes('SELECT id FROM stock_balance')) return [{ id: balanceId }];
      if (sql.includes('UPDATE stock_adjustment')) return [{ id: adjustmentId }];
      if (sql.includes('SELECT id,balance_id,delta_on_hand::text')) return [{
        id: adjustmentId, balance_id: balanceId, delta_on_hand: '1.250', reason: 'Kiểm kê', status: 'APPROVED',
        review_note: null, requested_at: new Date('2026-01-01T00:00:00.000Z'), reviewed_at: new Date('2026-01-01T00:01:00.000Z'),
      }];
      return [];
    }) };

    await command.execute(manager as never);
    const sqlCalls = manager.query.mock.calls.map(([sql]) => sql);
    expect(sqlCalls[0]).toContain('FROM stock_adjustment WHERE id=$1 FOR UPDATE');
    const balanceRead = sqlCalls.find((sql) => sql.includes('SELECT id FROM stock_balance'));
    expect(balanceRead).toBeDefined();
    expect(balanceRead).not.toContain('FOR UPDATE');
    const adjustmentMovement = manager.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO stock_movement'));
    expect(adjustmentMovement?.[1]).toEqual([balanceId, '1.250', adjustmentId, adjustmentId, actorId]);
    expect(sqlCalls.some((sql) => /UPDATE\s+stock_balance/iu.test(sql))).toBe(false);
  });
});
