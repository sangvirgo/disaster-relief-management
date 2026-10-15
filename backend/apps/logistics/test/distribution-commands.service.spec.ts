import { jest } from '@jest/globals';
import type { EntityManager } from 'typeorm';
import { DistributionCommandsService } from '../src/distributions/distribution-commands.service';
import type { DistributionContext } from '../src/distributions/distributions.read';

const itemId = '11111111-1111-4111-8111-111111111111';
const commitmentId = '22222222-2222-4222-8222-222222222222';
const needId = '33333333-3333-4333-8333-333333333333';
const cycleId = '44444444-4444-4444-8444-444444444444';

describe('DistributionCommandsService line validation lock order', () => {
  it('locks request cycle and commitment before locking catalog items', async () => {
    const context = {
      id: commitmentId,
      relief_need_id: needId,
      cycle_id: cycleId,
      item_id: itemId,
      warehouse_id: 'warehouse-1',
      organization_id: 'organization-1',
      cycle_state: 'OPEN',
      need_status: 'OPEN',
      delivery_target_kind: 'FINAL_RECIPIENT',
      designated_point_id: null,
      quantity: '1.00',
      released_quantity: '0.00',
      issued_quantity: '0.00',
      unit_scale: 2,
    };
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('cm.item_id')) return [context];
      if (sql.includes('SELECT cm.id,cm.relief_need_id,n.cycle_id')) {
        return [{ id: commitmentId, relief_need_id: needId, cycle_id: cycleId }];
      }
      if (sql.includes('FROM item i JOIN unit')) return [{ id: itemId, status: 'ACTIVE', unit_scale: 2 }];
      return [];
    });
    const service = Object.create(DistributionCommandsService.prototype) as unknown as {
      validateLines: (manager: EntityManager, distribution: DistributionContext, lines: { item_id: string; commitment_id: string; quantity: string }[]) => Promise<unknown>;
    };

    await service.validateLines({ query } as unknown as EntityManager, {
      purpose: 'REQUEST_AID',
      warehouse_id: 'warehouse-1',
      organization_id: 'organization-1',
      relief_point_id: null,
    } as DistributionContext, [{ item_id: itemId, commitment_id: commitmentId, quantity: '1.00' }]);

    const sqlCalls = query.mock.calls.map(([sql]) => String(sql));
    const cycleLock = sqlCalls.findIndex((sql) => sql.includes('FROM fulfillment_cycle') && sql.includes('FOR UPDATE'));
    const itemLock = sqlCalls.findIndex((sql) => sql.includes('FOR SHARE OF i'));
    expect(cycleLock).toBeGreaterThanOrEqual(0);
    expect(itemLock).toBeGreaterThan(cycleLock);
  });
});

describe('DistributionCommandsService vehicle capacity warning', () => {
  it('keeps over-capacity prepare and dispatch available and preserves stock outcomes', async () => {
    const distributionId = '55555555-5555-4555-8555-555555555555';
    const warehouseId = '66666666-6666-4666-8666-666666666666';
    const organizationId = '77777777-7777-4777-8777-777777777777';
    const lineId = '88888888-8888-4888-8888-888888888888';
    const preparerId = '99999999-9999-4999-8999-999999999999';
    const dispatcherId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const grants = [{ role_code: 'DISTRIBUTION_STAFF', scope_type: 'ORGANIZATION', organization_id: organizationId }];
    const distribution = {
      id: distributionId,
      warehouse_id: warehouseId,
      organization_id: organizationId,
      warehouse_region_code: 'north',
      warehouse_status: 'ACTIVE',
      relief_point_id: null,
      relief_point_status: null,
      vehicle_id: 'vehicle-1',
      vehicle_status: 'ACTIVE',
      vehicle_capacity: '1.00',
      vehicle_capacity_unit: 'kg',
      vehicle_capacity_scale: 2,
      campaign_id: null,
      purpose: 'REQUEST_AID',
      status: 'DRAFT',
      preparer_user_id: preparerId,
      approver_user_id: null as string | null,
      approved_version: null as number | null,
      dispatch_actor_user_id: null as string | null,
      dispatched_at: null as string | null,
      reconciled_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      version: 1,
    };
    const commitment = {
      id: commitmentId,
      item_id: itemId,
      warehouse_id: warehouseId,
      quantity: '5.00',
      released_quantity: '0.00',
      issued_quantity: '0.00',
      unit_scale: 2,
    };
    const lines: Array<{ id: string; item_id: string; commitment_id: string; quantity: string }> = [];
    const stock = { id: 'stock-balance-1', item_id: itemId, on_hand: '20.00', reserved: '5.00' };

    const distributionRow = () => ({ ...distribution });
    const lineView = () => lines.map((line) => ({
      distribution_id: distributionId,
      id: line.id,
      item_id: line.item_id,
      item_name: 'Rice',
      unit_code: 'kg',
      unit_scale: 2,
      commitment_id: line.commitment_id,
      delivery_target_kind: 'FINAL_RECIPIENT',
      quantity: line.quantity,
      in_transit_quantity: distribution.status === 'DISPATCHED' ? line.quantity : '0.00',
      at_point_quantity: '0.00',
      received_quantity: null,
      handed_out_quantity: null,
      returned_quantity: null,
      lost_quantity: null,
      pending_loss_count: '0',
    }));

    const query = jest.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes('SELECT organization_id,region_code,status FROM warehouse')) {
        return [{ organization_id: organizationId, region_code: 'north', status: 'ACTIVE' }];
      }
      if (sql.includes('SELECT organization_id,status FROM vehicle')) return [{ organization_id: organizationId, status: 'ACTIVE' }];
      if (sql.includes('FROM distribution d JOIN warehouse w')) return [distributionRow()];
      if (sql.includes('SELECT cm.id,cm.item_id,cm.warehouse_id,cm.quantity::text')) return [{ ...commitment }];
      if (sql.includes('SELECT dl.id,dl.item_id,dl.commitment_id,dl.quantity::text')) {
        return lines.map((line) => ({ ...line, unit_scale: 2 }));
      }
      if (sql.includes('SELECT dl.distribution_id,dl.id,dl.item_id,i.name')) return lineView();
      if (sql.includes('SELECT id,item_id,on_hand::text,reserved::text FROM stock_balance')) return [{ ...stock }];
      if (sql.includes("UPDATE distribution SET status='DRAFT'")) {
        Object.assign(distribution, {
          status: 'DRAFT', approver_user_id: null, approved_version: null, version: distribution.version + 1,
        });
      } else if (sql.includes("UPDATE distribution SET status='DISPATCHED'")) {
        Object.assign(distribution, {
          status: 'DISPATCHED', dispatch_actor_user_id: dispatcherId,
          dispatched_at: '2026-01-01T00:00:00.000Z', version: distribution.version + 1,
        });
        return [{ id: distributionId }];
      } else if (sql.includes('DELETE FROM distribution_line')) {
        lines.splice(0, lines.length);
      } else if (sql.includes('INSERT INTO distribution_line')) {
        lines.push({ id: lineId, item_id: String(values[2]), commitment_id: String(values[3]), quantity: String(values[4]) });
      } else if (sql.includes("VALUES ($1,'ISSUE',-$2::numeric,-$2::numeric,$3,$4,$5)")) {
        const quantity = Number(values[1]);
        stock.on_hand = (Number(stock.on_hand) - quantity).toFixed(2);
        stock.reserved = (Number(stock.reserved) - quantity).toFixed(2);
      }
      return [];
    });
    const manager = { query };
    const dataSource = { query };
    const idempotency = {
      execute: async (_source: unknown, command: { execute: (tx: EntityManager) => Promise<unknown> }) => ({
        ...(await command.execute(manager as unknown as EntityManager) as object), replay: false,
      }),
    };
    const sessions = {
      require: async (request: { userId: string }) => ({ userId: request.userId, grants }),
    };
    const service = Object.create(DistributionCommandsService.prototype) as DistributionCommandsService & {
      validateLines: (tx: EntityManager, context: DistributionContext, requestLines: { item_id: string; commitment_id?: string; quantity: string }[]) => Promise<{ commitments: typeof commitment[]; scales: Map<string, number> }>;
      dataSource: unknown;
      idempotency: unknown;
      sessions: unknown;
      campaigns: unknown;
    };
    Object.assign(service, { dataSource, idempotency, sessions, campaigns: {} });
    service.validateLines = async () => ({ commitments: [commitment], scales: new Map([[itemId, 2]]) });

    const prepared = await service.prepareFromCommitments(
      distributionId,
      { expected_version: 1 },
      { idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', userId: preparerId } as never,
    );
    expect(prepared.value).toMatchObject({ status: 'DRAFT', version: 2, vehicle_capacity_exceeded: true });
    expect(lines).toHaveLength(1);

    Object.assign(distribution, { status: 'APPROVED', approver_user_id: 'reviewer-1', approved_version: 2 });
    const dispatched = await service.dispatch(
      distributionId,
      { expected_version: 2 },
      { idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', userId: dispatcherId } as never,
    );
    expect(dispatched.value).toMatchObject({ status: 'DISPATCHED', version: 3, vehicle_capacity_exceeded: true });
    expect(stock).toMatchObject({ on_hand: '15.00', reserved: '0.00' });
  });
});
