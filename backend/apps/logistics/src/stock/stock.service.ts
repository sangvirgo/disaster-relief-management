import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { cleanText } from '../common/text';
import { validateQuantity, quantityUnits } from '../common/quantity';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import {
  CreateStockAdjustmentDto, OpeningStockDto, OpeningStockLineDto, ReviewStockAdjustmentDto,
} from './stock.dto';
import { assertIndependentAdjustmentReviewer, STOCK_ADJUSTMENT_ERROR_MAPPINGS } from './stock.helpers';
import { hasWarehouseScope, requireWarehousePermission } from './stock.scope';

type StockRequest = Request & { idempotencyKey?: string };

interface WarehouseContext {
  id: string;
  organization_id: string;
  region_code: string;
  status: 'ACTIVE' | 'INACTIVE';
}

interface BalanceContext {
  id: string;
  warehouse_id: string;
  item_id: string;
  organization_id: string;
  region_code: string;
  warehouse_status: 'ACTIVE' | 'INACTIVE';
  scale: number | string;
}

interface ItemScaleRow {
  id: string;
  status: 'ACTIVE' | 'INACTIVE';
  scale: number | string;
}

interface AdjustmentContext {
  id: string;
  balance_id: string;
  requested_by_user_id: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  organization_id: string;
  region_code: string;
}

function requestKey(request: StockRequest): string {
  if (!request.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
  return request.idempotencyKey;
}

function cleanReason(value: string): string {
  return cleanText(value, 1_000);
}

function requireExpectedWarehouse(session: Awaited<ReturnType<LogisticsSessionService['require']>>, warehouse: WarehouseContext): void {
  requireWarehousePermission(session.grants, 'ASSET_MANAGE', warehouse.organization_id, warehouse.region_code);
  if (warehouse.status !== 'ACTIVE') throw new AppError('VALIDATION_FAILED', { status: 400 });
}

async function activeItems(
  manager: Pick<DataSource | EntityManager, 'query'>,
  itemIds: readonly string[],
  lockRows = false,
): Promise<Map<string, ItemScaleRow>> {
  const rows = await manager.query(
    `SELECT i.id,i.status,u.scale FROM item i JOIN unit u ON u.code=i.unit_code WHERE i.id=ANY($1::uuid[])${lockRows ? ' FOR SHARE OF i' : ''}`,
    [[...itemIds]],
  ) as ItemScaleRow[];
  const items = new Map(rows.map((row) => [row.id, row]));
  if (items.size !== itemIds.length || rows.some((row) => row.status !== 'ACTIVE')) {
    throw new AppError('VALIDATION_FAILED', { status: 400 });
  }
  return items;
}

function validateOpeningLines(lines: readonly OpeningStockLineDto[], items: Map<string, ItemScaleRow>): void {
  for (const line of lines) {
    const item = items.get(line.item_id);
    if (!item) throw new AppError('VALIDATION_FAILED', { status: 400 });
    validateQuantity(line.quantity, Number(item.scale));
  }
}

function assertUniqueItems(lines: readonly OpeningStockLineDto[]): string[] {
  const itemIds = lines.map((line) => line.item_id);
  if (new Set(itemIds).size !== itemIds.length) throw new AppError('VALIDATION_FAILED', { status: 400 });
  return itemIds;
}

async function readBalanceContext(manager: Pick<DataSource | EntityManager, 'query'>, balanceId: string): Promise<BalanceContext | undefined> {
  const rows = await manager.query(
    `SELECT b.id,b.warehouse_id,b.item_id,w.organization_id,w.region_code,w.status AS warehouse_status,u.scale
       FROM stock_balance b JOIN warehouse w ON w.id=b.warehouse_id
       JOIN item i ON i.id=b.item_id JOIN unit u ON u.code=i.unit_code WHERE b.id=$1`,
    [balanceId],
  ) as BalanceContext[];
  return rows[0];
}

async function readAdjustment(manager: Pick<DataSource | EntityManager, 'query'>, id: string): Promise<Record<string, unknown>> {
  const rows = await manager.query(
    `SELECT id,balance_id,delta_on_hand::text AS delta_on_hand,reason,status,review_note,requested_at,reviewed_at
       FROM stock_adjustment WHERE id=$1`,
    [id],
  ) as Array<Record<string, unknown>>;
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return {
    ...rows[0],
    requested_at: new Date(rows[0].requested_at as Date | string).toISOString(),
    reviewed_at: rows[0].reviewed_at === null ? null : new Date(rows[0].reviewed_at as Date | string).toISOString(),
  };
}

async function readOpeningResult(
  manager: Pick<DataSource | EntityManager, 'query'>,
  warehouseId: string,
  itemIds: readonly string[],
): Promise<Record<string, unknown>> {
  const rows = await manager.query(
    `SELECT b.id AS balance_id,b.item_id,b.on_hand::text AS on_hand,b.reserved::text AS reserved,
            (b.on_hand-b.reserved)::text AS available
       FROM stock_balance b WHERE b.warehouse_id=$1 AND b.item_id=ANY($2::uuid[]) ORDER BY b.item_id ASC`,
    [warehouseId, [...itemIds]],
  ) as Array<Record<string, unknown>>;
  return { warehouse_id: warehouseId, items: rows };
}

@Injectable()
export class StockService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async opening(dto: OpeningStockDto, request: StockRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    if (dto.lines.length > 50) throw new AppError('TOO_MANY_LINES', { status: 400 });
    const itemIds = assertUniqueItems(dto.lines);
    const note = cleanReason(dto.note);
    const warehouses = await this.dataSource.query(
      'SELECT id,organization_id,region_code,status FROM warehouse WHERE id=$1',
      [dto.warehouse_id],
    ) as WarehouseContext[];
    const warehouse = warehouses[0];
    if (!warehouse) throw new AppError('NOT_FOUND', { status: 404 });
    requireExpectedWarehouse(session, warehouse);
    const itemScales = await activeItems(this.dataSource, itemIds);
    validateOpeningLines(dto.lines, itemScales);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.stock.opening',
      key: requestKey(request),
      requestHash: canonicalRequestHash({ actor_user_id: session.userId, dto }),
      async execute(manager) {
        const lockedWarehouses = await manager.query(
          'SELECT id,organization_id,region_code,status FROM warehouse WHERE id=$1 FOR SHARE',
          [dto.warehouse_id],
        ) as WarehouseContext[];
        const lockedWarehouse = lockedWarehouses[0];
        if (!lockedWarehouse) throw new AppError('NOT_FOUND', { status: 404 });
        requireExpectedWarehouse(session, lockedWarehouse);
        const currentItems = await activeItems(manager, itemIds, true);
        validateOpeningLines(dto.lines, currentItems);

        for (const itemId of [...itemIds].sort()) {
          await manager.query(
            `INSERT INTO stock_balance (warehouse_id,item_id) VALUES ($1,$2)
             ON CONFLICT (warehouse_id,item_id) DO NOTHING`,
            [dto.warehouse_id, itemId],
          );
        }
        const balances = await manager.query(
          `SELECT id,item_id FROM stock_balance WHERE warehouse_id=$1 AND item_id=ANY($2::uuid[])
           ORDER BY warehouse_id,item_id`,
          [dto.warehouse_id, [...itemIds].sort()],
        ) as Array<{ id: string; item_id: string }>;
        if (balances.length !== itemIds.length) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const linesByItem = new Map(dto.lines.map((line, index) => [line.item_id, { line, index }]));

        for (const balance of balances) {
          const entry = linesByItem.get(balance.item_id);
          if (!entry) throw new AppError('INTERNAL_ERROR', { status: 500 });
          await manager.query(
            `INSERT INTO stock_movement
               (balance_id,movement_type,delta_on_hand,delta_reserved,operation_ref,actor_user_id,reason)
             VALUES ($1,'OPENING',$2::numeric,0,$3,$4,$5)`,
            [balance.id, entry.line.quantity, `OPENING:${session.userId}:${request.idempotencyKey}:${entry.index + 1}`, session.userId, note],
          );
        }
        await manager.query(
          `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,after_state)
           VALUES ($1,'OPENING_STOCK_POSTED','warehouse',$2,$3::jsonb)`,
          [session.userId, dto.warehouse_id, JSON.stringify({ item_count: dto.lines.length })],
        );
        return {
          status: 201,
          value: await readOpeningResult(manager, dto.warehouse_id, itemIds),
          resource: { type: 'warehouse', id: dto.warehouse_id },
        };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'warehouse') throw new AppError('INTERNAL_ERROR', { status: 500 });
        return readOpeningResult(manager, resource.id, itemIds);
      },
    });
  }

  async createAdjustment(dto: CreateStockAdjustmentDto, request: StockRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const balance = await readBalanceContext(this.dataSource, dto.balance_id);
    if (!balance) throw new AppError('NOT_FOUND', { status: 404 });
    requireWarehousePermission(session.grants, 'STOCK_ADJUST_REQUEST', balance.organization_id, balance.region_code);
    validateQuantity(dto.delta_on_hand, Number(balance.scale), { allowNegative: true });
    const reason = cleanReason(dto.reason);
    if (dto.compensates_movement_id) await this.assertCompensation(this.dataSource, dto, balance);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.stock.adjustments.create',
      key: requestKey(request),
      requestHash: canonicalRequestHash({ actor_user_id: session.userId, dto }),
      databaseErrorMappings: { unique: { stock_adjustment_compensates_uq: 'STATE_TRANSITION_INVALID' } },
      execute: async (manager) => {
        const rows = await manager.query(
          `INSERT INTO stock_adjustment (balance_id,delta_on_hand,reason,requested_by_user_id,compensates_movement_id)
           VALUES ($1,$2::numeric,$3,$4,$5) RETURNING id`,
          [dto.balance_id, dto.delta_on_hand, reason, session.userId, dto.compensates_movement_id ?? null],
        ) as Array<{ id: string }>;
        const id = rows[0]?.id;
        if (!id) throw new AppError('INTERNAL_ERROR', { status: 500 });
        await manager.query(
          `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,after_state)
           VALUES ($1,'STOCK_ADJUSTMENT_REQUESTED','stock_adjustment',$2,$3::jsonb)`,
          [session.userId, id, JSON.stringify({ balance_id: dto.balance_id, delta_on_hand: dto.delta_on_hand, status: 'PENDING' })],
        );
        return {
          status: 201,
          value: await readAdjustment(manager, id),
          resource: { type: 'stock_adjustment', id },
        };
      },
      replay: async (manager, resource) => {
        if (!resource || resource.type !== 'stock_adjustment') throw new AppError('INTERNAL_ERROR', { status: 500 });
        return readAdjustment(manager, resource.id);
      },
    });
  }

  async reviewAdjustment(
    id: string,
    dto: ReviewStockAdjustmentDto,
    request: StockRequest,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const adjustments = await this.dataSource.query(
      `SELECT a.id,a.balance_id,a.requested_by_user_id,a.status,w.organization_id,w.region_code
         FROM stock_adjustment a JOIN stock_balance b ON b.id=a.balance_id
         JOIN warehouse w ON w.id=b.warehouse_id WHERE a.id=$1`,
      [id],
    ) as AdjustmentContext[];
    const adjustment = adjustments[0];
    if (!adjustment) throw new AppError('NOT_FOUND', { status: 404 });
    if (!hasWarehouseScope(session.grants, adjustment.organization_id, adjustment.region_code)) throw new AppError('NOT_FOUND', { status: 404 });
    requireWarehousePermission(session.grants, 'ADJUSTMENT_REVIEW', adjustment.organization_id, adjustment.region_code);
    assertIndependentAdjustmentReviewer(adjustment.requested_by_user_id, session.userId);
    const note = dto.note === undefined ? null : cleanReason(dto.note);
    if (dto.decision === 'REJECT' && note === null) throw new AppError('VALIDATION_FAILED', { status: 400 });

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.stock.adjustments.review',
      key: requestKey(request),
      requestHash: canonicalRequestHash({ actor_user_id: session.userId, adjustment_id: id, dto }),
      databaseErrorMappings: STOCK_ADJUSTMENT_ERROR_MAPPINGS,
      async execute(manager) {
        const rows = await manager.query(
          `SELECT id,balance_id,requested_by_user_id,delta_on_hand::text AS delta_on_hand,status,review_note
             FROM stock_adjustment WHERE id=$1 FOR UPDATE`,
          [id],
        ) as Array<{
          id: string; balance_id: string; requested_by_user_id: string; delta_on_hand: string;
          status: 'PENDING' | 'APPROVED' | 'REJECTED'; review_note: string | null;
        }>;
        const locked = rows[0];
        if (!locked) throw new AppError('NOT_FOUND', { status: 404 });
        if (locked.status !== 'PENDING') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        assertIndependentAdjustmentReviewer(locked.requested_by_user_id, session.userId);
        const balanceRows = await manager.query('SELECT id FROM stock_balance WHERE id=$1', [locked.balance_id]) as Array<{ id: string }>;
        if (!balanceRows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        const status = dto.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
        const updated = await manager.query(
          `UPDATE stock_adjustment SET status=$2,reviewed_by_user_id=$3,reviewed_at=now(),review_note=$4 WHERE id=$1 RETURNING id`,
          [id, status, session.userId, note],
        ) as Array<{ id: string }>;
        if (!updated[0]) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (dto.decision === 'APPROVE') {
          await manager.query(
            `INSERT INTO stock_movement
               (balance_id,movement_type,delta_on_hand,delta_reserved,adjustment_id,operation_ref,actor_user_id)
             VALUES ($1,'ADJUSTMENT',$2::numeric,0,$3,'ADJ:'||$4::text,$5)`,
            [locked.balance_id, locked.delta_on_hand, id, id, session.userId],
          );
        }
        await manager.query(
          `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state)
           VALUES ($1,'STOCK_ADJUSTMENT_REVIEWED','stock_adjustment',$2,$3::jsonb,$4::jsonb)`,
          [session.userId, id, JSON.stringify({ status: 'PENDING' }), JSON.stringify({ status, decision: dto.decision })],
        );
        return { status: 200, value: await readAdjustment(manager, id), resource: { type: 'stock_adjustment', id } };
      },
      replay: async (manager, resource) => {
        if (!resource || resource.type !== 'stock_adjustment') throw new AppError('INTERNAL_ERROR', { status: 500 });
        return readAdjustment(manager, resource.id);
      },
    });
  }

  private async assertCompensation(
    manager: Pick<DataSource | EntityManager, 'query'>,
    dto: CreateStockAdjustmentDto,
    balance: BalanceContext,
  ): Promise<void> {
    const rows = await manager.query(
      `SELECT id,balance_id,movement_type,delta_on_hand::text AS delta_on_hand,delta_reserved::text AS delta_reserved,
              receipt_id,commitment_id,distribution_line_id,handoff_line_id,adjustment_id
         FROM stock_movement WHERE id=$1`,
      [dto.compensates_movement_id],
    ) as Array<{
      id: string; balance_id: string; movement_type: string; delta_on_hand: string; delta_reserved: string;
      receipt_id: string | null; commitment_id: string | null; distribution_line_id: string | null;
      handoff_line_id: string | null; adjustment_id: string | null;
    }>;
    const movement = rows[0];
    if (!movement || movement.balance_id !== balance.id || !['OPENING', 'ADJUSTMENT'].includes(movement.movement_type) ||
        quantityUnits(movement.delta_reserved, 3) !== 0n || movement.receipt_id || movement.commitment_id ||
        movement.distribution_line_id || movement.handoff_line_id) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
    if (quantityUnits(dto.delta_on_hand, Number(balance.scale)) !== -quantityUnits(movement.delta_on_hand, Number(balance.scale))) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
  }
}
