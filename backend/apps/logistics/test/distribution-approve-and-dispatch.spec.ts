import { jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { DistributionCommandsService } from '../src/distributions/distribution-commands.service';

const distributionId = '55555555-5555-4555-8555-555555555555';
const warehouseId = '66666666-6666-4666-8666-666666666666';
const itemId = '11111111-1111-4111-8111-111111111111';
const lineId = '88888888-8888-4888-8888-888888888888';
const preparerId = '99999999-9999-4999-8999-999999999999';
const reviewerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** In-memory slip with one campaign line; enough SQL routing for approve, dispatch and the view read. */
function fixture(status: 'DRAFT' | 'APPROVED', approver: string | null = null) {
  const distribution = {
    id: distributionId, warehouse_id: warehouseId, warehouse_status: 'ACTIVE', campaign_id: null as string | null,
    purpose: 'REQUEST_AID', status, preparer_user_id: preparerId,
    approver_user_id: approver, approved_version: approver ? 1 : null as number | null,
    dispatch_actor_user_id: null as string | null, dispatched_at: null as string | null, reconciled_at: null,
    created_at: '2026-11-25T00:00:00.000Z', version: 1,
  };
  const stock = { id: 'stock-1', item_id: itemId, on_hand: '10', reserved: '4' };
  const audits: string[] = [];
  const query = jest.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('SELECT status FROM warehouse')) return [{ status: 'ACTIVE' }];
    if (sql.includes('FROM distribution d JOIN warehouse w')) return [{ ...distribution }];
    if (sql.includes('SELECT dl.id,dl.item_id,dl.commitment_id,dl.quantity::text')) {
      return [{ id: lineId, item_id: itemId, commitment_id: 'c-1', quantity: '4', unit_scale: 0 }];
    }
    if (sql.includes('SELECT dl.distribution_id,dl.id,dl.item_id,i.name')) {
      return [{ distribution_id: distributionId, id: lineId, item_id: itemId, item_name: 'Chăn', unit_code: 'CAI', unit_scale: 0,
        commitment_id: 'c-1', delivery_target_kind: 'FINAL_RECIPIENT', quantity: '4',
        in_transit_quantity: distribution.status === 'DISPATCHED' ? '4' : '0', received_quantity: null,
        handed_out_quantity: null, returned_quantity: null, lost_quantity: null, pending_loss_count: '0' }];
    }
    if (sql.includes('SELECT id,item_id,on_hand::text,reserved::text FROM stock_balance')) return [{ ...stock }];
    if (sql.includes("UPDATE distribution SET status='APPROVED'")) {
      Object.assign(distribution, { status: 'APPROVED', approver_user_id: values[1], approved_version: distribution.version });
      return [{ id: distributionId }];
    }
    if (sql.includes("UPDATE distribution SET status='DISPATCHED'")) {
      Object.assign(distribution, { status: 'DISPATCHED', dispatch_actor_user_id: values[1], dispatched_at: '2026-11-25T01:00:00.000Z', version: distribution.version + 1 });
      return [{ id: distributionId }];
    }
    if (sql.includes("VALUES ($1,'ISSUE',-$2::numeric,-$2::numeric,$3,$4,$5)")) {
      const quantity = Number(values[1]);
      stock.on_hand = String(Number(stock.on_hand) - quantity);
      stock.reserved = String(Number(stock.reserved) - quantity);
    }
    if (sql.includes('audit')) audits.push(String(values.find((value) => typeof value === 'string' && value.startsWith('DISTRIBUTION_')) ?? ''));
    return [];
  });
  const service = Object.create(DistributionCommandsService.prototype) as DistributionCommandsService & { validateLines: unknown };
  Object.assign(service, {
    dataSource: { query },
    idempotency: { execute: async (_source: unknown, command: { execute: (tx: EntityManager) => Promise<unknown> }) => ({
      ...(await command.execute({ query } as unknown as EntityManager) as object), replay: false,
    }) },
    sessions: { require: async (request: { userId: string }) => ({ userId: request.userId, grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }] }) },
    campaigns: {},
    validateLines: async () => ({ commitments: [{ id: 'c-1', item_id: itemId, warehouse_id: warehouseId, quantity: '4', released_quantity: '0', issued_quantity: '0', unit_scale: 0 }], scales: new Map([[itemId, 0]]) }),
  });
  return { service, distribution, stock, audits };
}

async function codeOf(promise: Promise<unknown>) {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(AppError);
  return (error as AppError).code;
}

describe('DistributionCommandsService shortened flow (2026-11-25)', () => {
  it('approves and dispatches a draft in one command by someone other than the preparer', async () => {
    const { service, distribution, stock } = fixture('DRAFT');
    const result = await service.approveAndDispatch(distributionId, { expected_version: 1 },
      { idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', userId: reviewerId } as never);
    expect(result.value).toMatchObject({ status: 'DISPATCHED', version: 2 });
    expect(distribution).toMatchObject({ approver_user_id: reviewerId, dispatch_actor_user_id: reviewerId, approved_version: 1 });
    expect(stock).toMatchObject({ on_hand: '6', reserved: '0' });
  });

  it('still refuses the preparer approving their own slip', async () => {
    const { service, distribution } = fixture('DRAFT');
    expect(await codeOf(service.approveAndDispatch(distributionId, { expected_version: 1 },
      { idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', userId: preparerId } as never))).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(distribution.status).toBe('DRAFT');
  });

  it('refuses a slip that is no longer a draft', async () => {
    const { service } = fixture('APPROVED', reviewerId);
    expect(await codeOf(service.approveAndDispatch(distributionId, { expected_version: 1 },
      { idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', userId: reviewerId } as never))).toBe('STATE_TRANSITION_INVALID');
  });

  it('lets the approver dispatch an already approved slip', async () => {
    const { service, distribution } = fixture('APPROVED', reviewerId);
    const result = await service.dispatch(distributionId, { expected_version: 1 },
      { idempotencyKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', userId: reviewerId } as never);
    expect(result.value).toMatchObject({ status: 'DISPATCHED' });
    expect(distribution.dispatch_actor_user_id).toBe(reviewerId);
  });
});
