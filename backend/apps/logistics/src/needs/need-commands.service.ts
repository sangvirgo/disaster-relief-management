import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import {
  canonicalRequestHash, IdempotencyService, IdempotentResult, ResourceRef,
} from '../../../../packages/technical/src/idempotency/idempotency';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { decimalFromUnits, quantityUnits, validateQuantity } from '../common/quantity';
import { AdjustNeedQuantityDto, CancelNeedDto } from './needs.dto';
import {
  NeedCommandRequest, NeedRow, needCommandKey, needValue, readNeed, requireNeedManage, writeNeedAudit,
} from './needs.helpers';

type NeedChange = 'increase' | 'reduce' | 'cancel';
type NeedChangeDto = AdjustNeedQuantityDto | CancelNeedDto;

interface CycleRow {
  id: string;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
  state: 'OPEN' | 'FROZEN' | 'SEALED';
}

interface CommitmentRow {
  id: string;
  warehouse_id: string;
  quantity: string;
  released_quantity: string;
  issued_quantity: string;
  delivered_quantity: string;
  returned_quantity: string;
  lost_quantity: string;
  version: number | string;
}

interface StockBalanceRow {
  id: string;
  warehouse_id: string;
  item_id: string;
  reserved: string;
}

interface NeedTotals {
  delivered: bigint;
  reserved: bigint;
  unsettledIssued: bigint;
}

function totals(rows: readonly CommitmentRow[], scale: number): NeedTotals {
  return rows.reduce<NeedTotals>((sum, row) => {
    const quantity = quantityUnits(row.quantity, scale);
    const released = quantityUnits(row.released_quantity, scale);
    const issued = quantityUnits(row.issued_quantity, scale);
    const delivered = quantityUnits(row.delivered_quantity, scale);
    const returned = quantityUnits(row.returned_quantity, scale);
    const lost = quantityUnits(row.lost_quantity, scale);
    const reserved = quantity - released - issued;
    const unsettledIssued = issued - delivered - returned - lost;
    if (reserved < 0n || unsettledIssued < 0n) throw new AppError('INTERNAL_ERROR', { status: 500 });
    return {
      delivered: sum.delivered + delivered,
      reserved: sum.reserved + reserved,
      unsettledIssued: sum.unsettledIssued + unsettledIssued,
    };
  }, { delivered: 0n, reserved: 0n, unsettledIssued: 0n });
}

function needStatus(delivered: bigint, requested: bigint): NeedRow['status'] {
  if (delivered === requested) return 'FULFILLED';
  return delivered === 0n ? 'OPEN' : 'PARTIALLY_FULFILLED';
}

async function needCycleId(manager: Pick<EntityManager, 'query'>, needId: string): Promise<string> {
  const rows = await manager.query('SELECT cycle_id FROM relief_need WHERE id=$1', [needId]) as Array<{ cycle_id: string }>;
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return rows[0].cycle_id;
}

async function lockCycle(manager: Pick<EntityManager, 'query'>, cycleId: string): Promise<CycleRow> {
  const rows = await manager.query(
    `SELECT id,organization_id,region_code,campaign_id,state
       FROM fulfillment_cycle WHERE id=$1 FOR UPDATE`,
    [cycleId],
  ) as CycleRow[];
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return rows[0];
}

async function lockNeed(manager: Pick<EntityManager, 'query'>, needId: string, cycleId: string): Promise<NeedRow> {
  const rows = await manager.query(
    `SELECT n.id,n.cycle_id,c.request_id,c.work_cycle,c.organization_id,c.region_code,c.campaign_id,
            n.item_id,i.name AS item_name,u.code AS unit_code,u.display_name AS unit_name,u.scale AS unit_scale,
            n.original_quantity::text,n.requested_quantity::text,n.cancelled_remaining::text,
            n.designated_point_id,n.status,n.version,n.created_at
       FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id
       JOIN item i ON i.id=n.item_id JOIN unit u ON u.code=i.unit_code
      WHERE n.id=$1 AND n.cycle_id=$2 FOR UPDATE OF n`,
    [needId, cycleId],
  ) as NeedRow[];
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return rows[0];
}

async function lockCommitments(manager: Pick<EntityManager, 'query'>, needId: string): Promise<CommitmentRow[]> {
  return manager.query(
    `SELECT id,warehouse_id,quantity::text,released_quantity::text,issued_quantity::text,
            delivered_quantity::text,returned_quantity::text,lost_quantity::text,version
       FROM commitment WHERE relief_need_id=$1 ORDER BY id FOR UPDATE`,
    [needId],
  ) as Promise<CommitmentRow[]>;
}

async function releaseReservations(
  manager: Pick<EntityManager, 'query'>,
  need: NeedRow,
  commitments: readonly CommitmentRow[],
  actorId: string,
): Promise<void> {
  const scale = Number(need.unit_scale);
  const rows = commitments.map((row) => ({
    ...row,
    reserved: quantityUnits(row.quantity, scale) - quantityUnits(row.released_quantity, scale) - quantityUnits(row.issued_quantity, scale),
  })).filter((row) => row.reserved > 0n);
  if (!rows.length) return;

  const warehouseIds = [...new Set(rows.map((row) => row.warehouse_id))].sort();
  const balances = await manager.query(
    `SELECT id,warehouse_id,item_id,reserved::text
       FROM stock_balance WHERE warehouse_id=ANY($1::uuid[]) AND item_id=$2
      ORDER BY warehouse_id,item_id FOR UPDATE`,
    [warehouseIds, need.item_id],
  ) as StockBalanceRow[];
  const byWarehouse = new Map(balances.map((balance) => [balance.warehouse_id, balance]));
  const totalByWarehouse = new Map<string, bigint>();
  for (const row of rows) totalByWarehouse.set(row.warehouse_id, (totalByWarehouse.get(row.warehouse_id) ?? 0n) + row.reserved);
  for (const [warehouseId, amount] of totalByWarehouse) {
    const balance = byWarehouse.get(warehouseId);
    if (!balance || quantityUnits(balance.reserved, scale) < amount) throw new AppError('INTERNAL_ERROR', { status: 500 });
  }

  for (const row of rows) {
    const balance = byWarehouse.get(row.warehouse_id);
    if (!balance) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const amount = decimalFromUnits(row.reserved, scale);
    const updated = await manager.query(
      `UPDATE commitment SET released_quantity=released_quantity+$2::numeric,version=version+1
        WHERE id=$1 AND version=$3 RETURNING id`,
      [row.id, amount, row.version],
    ) as Array<{ id: string }>;
    if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
    await manager.query(
      `INSERT INTO stock_movement
         (balance_id,movement_type,delta_on_hand,delta_reserved,commitment_id,operation_ref,actor_user_id)
       VALUES ($1,'RELEASE',0,-$2::numeric,$3,$4,$5)`,
      [balance.id, amount, row.id, `NEED_CANCEL:${need.id}:${row.id}`, actorId],
    );
  }
}

function assertCycleAllows(cycle: CycleRow, action: NeedChange): void {
  if (cycle.state === 'SEALED') throw new AppError('CYCLE_SEALED', { status: 409 });
  if (cycle.state === 'FROZEN' && action !== 'cancel') throw new AppError('CYCLE_FROZEN', { status: 409 });
  if (cycle.state !== 'OPEN' && !(cycle.state === 'FROZEN' && action === 'cancel')) {
    throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
  }
}

@Injectable()
export class NeedCommandsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: LogisticsSessionService,
  ) {}

  increase(id: string, dto: AdjustNeedQuantityDto, request: NeedCommandRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.change('increase', id, dto, request);
  }

  reduce(id: string, dto: AdjustNeedQuantityDto, request: NeedCommandRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.change('reduce', id, dto, request);
  }

  cancel(id: string, dto: CancelNeedDto, request: NeedCommandRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.change('cancel', id, dto, request);
  }

  private async change(
    action: NeedChange,
    id: string,
    dto: NeedChangeDto,
    request: NeedCommandRequest,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const idempotencyKey = needCommandKey(request);
    const scopeRows = await this.dataSource.query(
      `SELECT c.organization_id,c.region_code,c.campaign_id
         FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id WHERE n.id=$1`,
      [id],
    ) as Array<Pick<CycleRow, 'organization_id' | 'region_code' | 'campaign_id'>>;
    if (!scopeRows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    requireNeedManage(session.grants, scopeRows[0]);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: `logistics.needs.${action}`,
      key: idempotencyKey,
      requestHash: canonicalRequestHash({ relief_need_id: id, action, dto }),
      execute: async (manager) => {
        const cycleId = await needCycleId(manager, id);
        const cycle = await lockCycle(manager, cycleId);
        requireNeedManage(session.grants, cycle);
        assertCycleAllows(cycle, action);
        const need = await lockNeed(manager, id, cycleId);
        requireNeedManage(session.grants, need);
        if (need.status === 'CANCELLED') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (Number(need.version) !== dto.expected_version) {
          throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(need.version) } });
        }

        const before = needValue(need);
        const commitments = await lockCommitments(manager, id);
        const current = totals(commitments, Number(need.unit_scale));
        if (action === 'cancel') return this.cancelInTransaction(manager, need, commitments, current, session.userId, dto as CancelNeedDto, before);
        return this.adjustInTransaction(manager, action, need, current, session.userId, dto as AdjustNeedQuantityDto, before);
      },
      replay: async (manager, resource: ResourceRef | null) => {
        if (resource?.type !== 'relief_need') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const value = await readNeed(manager, resource.id);
        requireNeedManage(session.grants, value as Pick<NeedRow, 'organization_id' | 'region_code' | 'campaign_id'>);
        return value;
      },
    });
  }

  private async adjustInTransaction(
    manager: EntityManager,
    action: 'increase' | 'reduce',
    need: NeedRow,
    current: NeedTotals,
    actorId: string,
    dto: AdjustNeedQuantityDto,
    before: Record<string, unknown>,
  ) {
    const scale = Number(need.unit_scale);
    const quantity = validateQuantity(dto.quantity, scale);
    const next = quantityUnits(quantity, scale);
    const previous = quantityUnits(need.requested_quantity, scale);
    if ((action === 'increase' && next <= previous) || (action === 'reduce' && next >= previous)) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
    if (action === 'reduce' && next < current.delivered + current.reserved + current.unsettledIssued) {
      throw new AppError('BELOW_PROTECTED_QUANTITY', { status: 409 });
    }
    const status = needStatus(current.delivered, next);
    const updated = await manager.query(
      `UPDATE relief_need SET requested_quantity=$3::numeric,status=$4,version=version+1
        WHERE id=$1 AND version=$2 RETURNING id`,
      [need.id, dto.expected_version, quantity, status],
    ) as Array<{ id: string }>;
    if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
    const value = await readNeed(manager, need.id);
    await writeNeedAudit(manager, actorId, action === 'increase' ? 'NEED_INCREASED' : 'NEED_REDUCED', need.id, before, value, dto.reason);
    return { status: 200, value, resource: { type: 'relief_need', id: need.id } };
  }

  private async cancelInTransaction(
    manager: EntityManager,
    need: NeedRow,
    commitments: readonly CommitmentRow[],
    current: NeedTotals,
    actorId: string,
    dto: CancelNeedDto,
    before: Record<string, unknown>,
  ) {
    if (current.unsettledIssued > 0n) throw new AppError('UNSETTLED_ISSUED_GOODS', { status: 409 });
    const requested = quantityUnits(need.requested_quantity, Number(need.unit_scale));
    const cancelledRemaining = requested - current.delivered;
    if (cancelledRemaining < 0n) throw new AppError('INTERNAL_ERROR', { status: 500 });
    await releaseReservations(manager, need, commitments, actorId);
    const updated = await manager.query(
      `UPDATE relief_need SET cancelled_remaining=$3::numeric,status='CANCELLED',version=version+1
        WHERE id=$1 AND version=$2 RETURNING id`,
      [need.id, dto.expected_version, cancelledRemaining.toString()],
    ) as Array<{ id: string }>;
    if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
    const value = await readNeed(manager, need.id);
    await writeNeedAudit(manager, actorId, 'NEED_CANCELLED', need.id, before, value, dto.reason);
    return { status: 200, value, resource: { type: 'relief_need', id: need.id } };
  }
}
