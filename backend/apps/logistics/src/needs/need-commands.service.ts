import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import {
  canonicalRequestHash, IdempotencyService, IdempotentResult, ResourceRef,
} from '@c48/technical/idempotency/idempotency';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { decimalFromUnits, quantityUnits, validateQuantity } from '../common/quantity';
import { AdjustNeedQuantityDto, CancelNeedDto, ConfirmNeedDto } from './needs.dto';
import {
  NeedCommandRequest, NeedRow, needCommandKey, needValue, readNeed, requireNeedEstimateConfirm, requireNeedManage,
  writeNeedAudit,
} from './needs.helpers';

type NeedChange = 'increase' | 'reduce' | 'cancel';
type NeedChangeDto = AdjustNeedQuantityDto | CancelNeedDto;

interface CycleRow {
  id: string;
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
    `SELECT id,campaign_id,state
       FROM fulfillment_cycle WHERE id=$1 FOR UPDATE`,
    [cycleId],
  ) as CycleRow[];
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return rows[0];
}

async function loadItemTypeAndScale(manager: Pick<EntityManager, 'query'>, itemId: string): Promise<{ item_type_code: string; scale: number }> {
  const rows = await manager.query(
    'SELECT i.item_type_code, u.scale FROM item i JOIN unit u ON u.code=i.unit_code WHERE i.id=$1',
    [itemId],
  ) as Array<{ item_type_code: string; scale: number | string }>;
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return { item_type_code: rows[0].item_type_code, scale: Number(rows[0].scale) };
}

/** The replacement item for a confirm swap: ACTIVE and of the same item type as the estimate it replaces. */
async function loadConfirmTarget(
  manager: Pick<EntityManager, 'query'>,
  itemId: string,
  itemTypeCode: string,
): Promise<{ id: string; scale: number }> {
  const rows = await manager.query(
    `SELECT i.id,i.status,i.item_type_code,u.scale FROM item i JOIN unit u ON u.code=i.unit_code
      WHERE i.id=$1 FOR SHARE OF i`,
    [itemId],
  ) as Array<{ id: string; status: string; item_type_code: string; scale: number | string }>;
  const item = rows[0];
  if (!item) throw new AppError('NOT_FOUND', { status: 404 });
  if (item.status !== 'ACTIVE') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
  if (item.item_type_code !== itemTypeCode) throw new AppError('NEED_ITEM_TYPE_MISMATCH', { status: 400 });
  return { id: item.id, scale: Number(item.scale) };
}

/** Re-expresses a quantity from one unit scale to another, rounding UP when the new scale is coarser. */
function convertUpUnits(units: bigint, fromScale: number, toScale: number): bigint {
  if (toScale >= fromScale) return units * 10n ** BigInt(toScale - fromScale);
  const divisor = 10n ** BigInt(fromScale - toScale);
  return (units + divisor - 1n) / divisor;
}

async function lockNeed(manager: Pick<EntityManager, 'query'>, needId: string, cycleId: string): Promise<NeedRow> {
  const rows = await manager.query(
    `SELECT n.id,n.cycle_id,c.request_id,c.work_cycle,c.campaign_id,
            n.item_id,i.name AS item_name,u.code AS unit_code,u.display_name AS unit_name,u.scale AS unit_scale,
            n.original_quantity::text,n.requested_quantity::text,n.cancelled_remaining::text,
            n.status,n.source,n.estimate_basis,n.version,n.created_at
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
  // Reservation changes go through the movement trigger; the app role cannot row-lock this protected table.
  const balances = await manager.query(
    `SELECT id,warehouse_id,item_id,reserved::text
       FROM stock_balance WHERE warehouse_id=ANY($1::uuid[]) AND item_id=$2
      ORDER BY warehouse_id,item_id`,
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

  /** Turns an ESTIMATED need into CONFIRMED, optionally changing its quantity. Only the estimate-confirm permission applies. */
  async confirm(id: string, dto: ConfirmNeedDto, request: NeedCommandRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const idempotencyKey = needCommandKey(request);
    const scopeRows = await this.dataSource.query(
      `SELECT c.campaign_id
         FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id WHERE n.id=$1`,
      [id],
    ) as Array<Pick<CycleRow, 'campaign_id'>>;
    if (!scopeRows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    requireNeedEstimateConfirm(session.grants, scopeRows[0]);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.needs.confirm',
      key: idempotencyKey,
      requestHash: canonicalRequestHash({ relief_need_id: id, dto }),
      execute: async (manager) => {
        const cycleId = await needCycleId(manager, id);
        const cycle = await lockCycle(manager, cycleId);
        requireNeedEstimateConfirm(session.grants, cycle);
        // Confirmation is a review step, so it uses the same OPEN-only rule as increase (not the reduce direction rule).
        assertCycleAllows(cycle, 'increase');
        const need = await lockNeed(manager, id, cycleId);
        requireNeedEstimateConfirm(session.grants, need);
        if (need.source !== 'ESTIMATED') throw new AppError('NEED_NOT_ESTIMATED', { status: 409 });
        if (need.status === 'CANCELLED') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (Number(need.version) !== dto.expected_version) {
          throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(need.version) } });
        }

        // Optional swap to another ACTIVE item of the same item type. An estimate has no commitments, so no stock moves here.
        const currentItem = await loadItemTypeAndScale(manager, need.item_id);
        const swap = dto.item_id !== undefined && dto.item_id !== need.item_id;
        if (swap && !dto.reason?.trim()) throw new AppError('VALIDATION_FAILED', { status: 400 });
        const target = swap
          ? await loadConfirmTarget(manager, dto.item_id!, currentItem.item_type_code)
          : { id: need.item_id, scale: currentItem.scale };
        if (swap) {
          const clash = await manager.query(
            `SELECT id FROM relief_need WHERE cycle_id=$1 AND item_id=$2 AND status<>'CANCELLED' LIMIT 1`,
            [cycleId, target.id],
          ) as Array<{ id: string }>;
          if (clash[0]) throw new AppError('NEED_EXISTS', { status: 409 });
        }
        const scale = target.scale;
        // A swap re-expresses the current quantity in the new unit scale, rounded UP, so no amount is silently truncated.
        const baseUnits = swap
          ? convertUpUnits(quantityUnits(need.requested_quantity, currentItem.scale), currentItem.scale, scale)
          : quantityUnits(need.requested_quantity, scale);
        const changed = swap || (dto.quantity !== undefined && quantityUnits(dto.quantity, scale) !== baseUnits);
        if (changed && !dto.reason?.trim()) throw new AppError('VALIDATION_FAILED', { status: 400 });
        const quantity = dto.quantity === undefined ? decimalFromUnits(baseUnits, scale) : validateQuantity(dto.quantity, scale);
        const next = quantityUnits(quantity, scale);
        const before = needValue(need);
        const commitments = await lockCommitments(manager, id);
        const current = totals(commitments, scale);
        if (next < current.delivered + current.reserved + current.unsettledIssued) {
          throw new AppError('BELOW_PROTECTED_QUANTITY', { status: 409 });
        }
        const updated = await manager.query(
          `UPDATE relief_need SET item_id=$5::uuid,requested_quantity=$3::numeric,source='CONFIRMED',status=$4,version=version+1
            WHERE id=$1 AND version=$2 RETURNING id`,
          [need.id, dto.expected_version, decimalFromUnits(next, scale), needStatus(current.delivered, next), target.id],
        ) as Array<{ id: string }>;
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const value = await readNeed(manager, need.id);
        await writeNeedAudit(manager, session.userId, 'NEED_CONFIRMED', need.id, before, value, dto.reason?.trim() || null);
        return { status: 200, value, resource: { type: 'relief_need', id: need.id } };
      },
      replay: async (manager, resource: ResourceRef | null) => {
        if (resource?.type !== 'relief_need') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const value = await readNeed(manager, resource.id);
        requireNeedEstimateConfirm(session.grants, value as Pick<NeedRow, 'campaign_id'>);
        return value;
      },
    });
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
      `SELECT c.campaign_id
         FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id WHERE n.id=$1`,
      [id],
    ) as Array<Pick<CycleRow, 'campaign_id'>>;
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
        // An estimate must be confirmed (quantity edits go through confirm), but it can still be cancelled.
        if (action !== 'cancel' && need.source === 'ESTIMATED') throw new AppError('NEED_ESTIMATE_NOT_CONFIRMED', { status: 409 });
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
        requireNeedManage(session.grants, value as Pick<NeedRow, 'campaign_id'>);
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
    const scale = Number(need.unit_scale);
    const requested = quantityUnits(need.requested_quantity, scale);
    const cancelledRemaining = requested - current.delivered;
    if (cancelledRemaining < 0n) throw new AppError('INTERNAL_ERROR', { status: 500 });
    await releaseReservations(manager, need, commitments, actorId);
    const updated = await manager.query(
      `UPDATE relief_need SET cancelled_remaining=$3::numeric,status='CANCELLED',version=version+1
        WHERE id=$1 AND version=$2 RETURNING id`,
      [need.id, dto.expected_version, decimalFromUnits(cancelledRemaining, scale)],
    ) as Array<{ id: string }>;
    if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
    const value = await readNeed(manager, need.id);
    await writeNeedAudit(manager, actorId, 'NEED_CANCELLED', need.id, before, value, dto.reason);
    return { status: 200, value, resource: { type: 'relief_need', id: need.id } };
  }
}
