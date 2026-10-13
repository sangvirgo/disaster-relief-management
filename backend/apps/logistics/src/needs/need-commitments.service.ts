import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import {
  canonicalRequestHash, IdempotencyService, IdempotentResult, ResourceRef,
} from '../../../../packages/technical/src/idempotency/idempotency';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { decimalFromUnits, quantityUnits, validateQuantity } from '../common/quantity';
import { requireWarehousePermission } from '../stock/stock.scope';
import { LogisticsResponseCampaignClient, ResponseCampaign } from '../integrations/response/response-campaign.client';
import { CreateNeedCommitmentDto, ReleaseCommitmentDto } from './needs.dto';
import { NeedCommandRequest, needCommandKey } from './needs.helpers';

interface NeedContext {
  id: string;
  cycle_id: string;
  item_id: string;
  status: 'OPEN' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'CANCELLED';
  requested_quantity: string;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
  unit_scale: number | string;
}

interface CycleRow {
  id: string;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
  state: 'OPEN' | 'FROZEN' | 'SEALED';
}

interface WarehouseRow {
  id: string;
  organization_id: string;
  region_code: string;
  status: 'ACTIVE' | 'INACTIVE';
}

interface CommitmentRow {
  id: string;
  relief_need_id: string;
  item_id: string;
  warehouse_id: string;
  quantity: string;
  released_quantity: string;
  issued_quantity: string;
  delivered_quantity: string;
  returned_quantity: string;
  lost_quantity: string;
  version: number | string;
}

interface BalanceRow {
  id: string;
  warehouse_id: string;
  item_id: string;
  on_hand: string;
  reserved: string;
}

async function loadNeedContext(source: Pick<DataSource | EntityManager, 'query'>, id: string): Promise<NeedContext> {
  const rows = await source.query(
    `SELECT n.id,n.cycle_id,n.item_id,n.status,n.requested_quantity::text,
            c.organization_id,c.region_code,c.campaign_id,u.scale AS unit_scale
       FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id
       JOIN item i ON i.id=n.item_id JOIN unit u ON u.code=i.unit_code WHERE n.id=$1`,
    [id],
  ) as NeedContext[];
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return rows[0];
}

async function loadWarehouse(source: Pick<DataSource | EntityManager, 'query'>, id: string): Promise<WarehouseRow> {
  const rows = await source.query(
    'SELECT id,organization_id,region_code,status FROM warehouse WHERE id=$1',
    [id],
  ) as WarehouseRow[];
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return rows[0];
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

async function lockNeed(manager: Pick<EntityManager, 'query'>, needId: string, cycleId: string): Promise<NeedContext> {
  const rows = await manager.query(
    `SELECT n.id,n.cycle_id,n.item_id,n.status,n.requested_quantity::text,
            c.organization_id,c.region_code,c.campaign_id,u.scale AS unit_scale
       FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id
       JOIN item i ON i.id=n.item_id JOIN unit u ON u.code=i.unit_code
      WHERE n.id=$1 AND n.cycle_id=$2 FOR UPDATE OF n`,
    [needId, cycleId],
  ) as NeedContext[];
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return rows[0];
}

async function lockCommitments(manager: Pick<EntityManager, 'query'>, needId: string): Promise<CommitmentRow[]> {
  return manager.query(
    `SELECT id,relief_need_id,item_id,warehouse_id,quantity::text,released_quantity::text,
            issued_quantity::text,delivered_quantity::text,returned_quantity::text,lost_quantity::text,version
       FROM commitment WHERE relief_need_id=$1 ORDER BY id FOR UPDATE`,
    [needId],
  ) as Promise<CommitmentRow[]>;
}

async function readCommitmentContext(
  source: Pick<DataSource | EntityManager, 'query'>,
  id: string,
): Promise<NeedContext & CommitmentRow> {
  const rows = await source.query(
    `SELECT cm.id,cm.relief_need_id,cm.item_id,cm.warehouse_id,cm.quantity::text,
            cm.released_quantity::text,cm.issued_quantity::text,cm.delivered_quantity::text,
            cm.returned_quantity::text,cm.lost_quantity::text,cm.version,
            n.cycle_id,n.status,n.requested_quantity::text,c.organization_id,c.region_code,c.campaign_id,
            u.scale AS unit_scale
       FROM commitment cm JOIN relief_need n ON n.id=cm.relief_need_id
       JOIN fulfillment_cycle c ON c.id=n.cycle_id
       JOIN item i ON i.id=n.item_id JOIN unit u ON u.code=i.unit_code WHERE cm.id=$1`,
    [id],
  ) as Array<NeedContext & CommitmentRow>;
  if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
  return rows[0];
}

function assertWarehouseScope(
  grants: Awaited<ReturnType<LogisticsSessionService['require']>>['grants'],
  warehouse: WarehouseRow,
  organizationId: string,
): void {
  requireWarehousePermission(grants, 'COMMITMENT_MANAGE', warehouse.organization_id, warehouse.region_code);
  if (warehouse.organization_id !== organizationId) throw new AppError('VALIDATION_FAILED', { status: 400 });
}

function assertCreateCycle(cycle: CycleRow): void {
  if (cycle.state === 'SEALED') throw new AppError('CYCLE_SEALED', { status: 409 });
  if (cycle.state === 'FROZEN') throw new AppError('CYCLE_FROZEN', { status: 409 });
  if (cycle.state !== 'OPEN') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
}

function assertReleaseCycle(cycle: CycleRow): void {
  if (cycle.state === 'SEALED') throw new AppError('CYCLE_SEALED', { status: 409 });
  if (cycle.state !== 'OPEN' && cycle.state !== 'FROZEN') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
}

function commitmentValue(row: CommitmentRow, scale: number): Record<string, unknown> {
  const quantity = quantityUnits(row.quantity, scale);
  const released = quantityUnits(row.released_quantity, scale);
  const issued = quantityUnits(row.issued_quantity, scale);
  return {
    id: row.id,
    relief_need_id: row.relief_need_id,
    item_id: row.item_id,
    warehouse_id: row.warehouse_id,
    quantity: decimalFromUnits(quantity, scale),
    released_quantity: decimalFromUnits(released, scale),
    issued_quantity: decimalFromUnits(issued, scale),
    delivered_quantity: decimalFromUnits(quantityUnits(row.delivered_quantity, scale), scale),
    returned_quantity: decimalFromUnits(quantityUnits(row.returned_quantity, scale), scale),
    lost_quantity: decimalFromUnits(quantityUnits(row.lost_quantity, scale), scale),
    reserved_remaining: decimalFromUnits(quantity - released - issued, scale),
    version: Number(row.version),
  };
}

async function auditCommitment(
  manager: Pick<EntityManager, 'query'>,
  actorId: string,
  action: 'COMMITMENT_CREATED' | 'COMMITMENT_RELEASED',
  id: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  reason: string | null,
): Promise<void> {
  await manager.query(
    `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,before_state,after_state,reason)
     VALUES ($1,$2,'commitment',$3,$4::jsonb,$5::jsonb,$6)`,
    [actorId, action, id, before ? JSON.stringify(before) : null, JSON.stringify(after), reason],
  );
}

@Injectable()
export class NeedCommitmentsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: LogisticsSessionService,
    private readonly campaigns: LogisticsResponseCampaignClient,
  ) {}

  async create(
    needId: string,
    dto: CreateNeedCommitmentDto,
    request: NeedCommandRequest,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = needCommandKey(request);
    const need = await loadNeedContext(this.dataSource, needId);
    const warehouse = await loadWarehouse(this.dataSource, dto.warehouse_id);
    assertWarehouseScope(session.grants, warehouse, need.organization_id);

    let campaign: ResponseCampaign | null = null;
    let campaignFailure: unknown;
    if (need.campaign_id) {
      try {
        campaign = await this.campaigns.getCampaign(need.campaign_id);
      } catch (error) {
        campaignFailure = error;
      }
    }

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.needs.commitments.create',
      key,
      requestHash: canonicalRequestHash({ relief_need_id: needId, dto }),
      databaseErrorMappings: { check: { stock_balance_check: 'INSUFFICIENT_STOCK' } },
      execute: async (manager) => {
        const cycle = await lockCycle(manager, need.cycle_id);
        assertCreateCycle(cycle);
        const lockedNeed = await lockNeed(manager, needId, cycle.id);
        if (lockedNeed.status === 'CANCELLED') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const lockedWarehouse = await loadWarehouse(manager, dto.warehouse_id);
        assertWarehouseScope(session.grants, lockedWarehouse, cycle.organization_id);
        if (cycle.campaign_id !== need.campaign_id || lockedNeed.campaign_id !== cycle.campaign_id) {
          throw new AppError('INTERNAL_ERROR', { status: 500 });
        }
        this.assertCampaign(campaignFailure, campaign, cycle);

        const scale = Number(lockedNeed.unit_scale);
        const quantity = validateQuantity(dto.quantity, scale);
        const requested = quantityUnits(quantity, scale);
        const commitments = await lockCommitments(manager, needId);
        let delivered = 0n;
        let reservedRemaining = 0n;
        let unsettledIssued = 0n;
        for (const row of commitments) {
          const rowQuantity = quantityUnits(row.quantity, scale);
          const released = quantityUnits(row.released_quantity, scale);
          const issued = quantityUnits(row.issued_quantity, scale);
          const rowDelivered = quantityUnits(row.delivered_quantity, scale);
          const returned = quantityUnits(row.returned_quantity, scale);
          const lost = quantityUnits(row.lost_quantity, scale);
          const remaining = rowQuantity - released - issued;
          const unsettled = issued - rowDelivered - returned - lost;
          if (remaining < 0n || unsettled < 0n) throw new AppError('INTERNAL_ERROR', { status: 500 });
          delivered += rowDelivered;
          reservedRemaining += remaining;
          unsettledIssued += unsettled;
        }
        if (delivered + reservedRemaining + unsettledIssued + requested > quantityUnits(lockedNeed.requested_quantity, scale)) {
          throw new AppError('NEED_OVER_COMMITTED', { status: 409 });
        }

        // The app role cannot row-lock stock_balance; its movement trigger serializes writes and enforces availability.
        const balances = await manager.query(
          `SELECT id,warehouse_id,item_id,on_hand::text,reserved::text FROM stock_balance
            WHERE warehouse_id=$1 AND item_id=$2 ORDER BY warehouse_id,item_id`,
          [dto.warehouse_id, lockedNeed.item_id],
        ) as BalanceRow[];
        const balance = balances[0];
        if (!balance || quantityUnits(balance.on_hand, scale) - quantityUnits(balance.reserved, scale) < requested) {
          throw new AppError('INSUFFICIENT_STOCK', { status: 409 });
        }

        const inserted = await manager.query(
          `INSERT INTO commitment (relief_need_id,item_id,warehouse_id,quantity,created_by_user_id)
           VALUES ($1,$2,$3,$4::numeric,$5) RETURNING id`,
          [needId, lockedNeed.item_id, dto.warehouse_id, quantity, session.userId],
        ) as Array<{ id: string }>;
        const id = inserted[0]?.id;
        if (!id) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const value = commitmentValue({
          id, relief_need_id: needId, item_id: lockedNeed.item_id, warehouse_id: dto.warehouse_id,
          quantity, released_quantity: '0', issued_quantity: '0', delivered_quantity: '0',
          returned_quantity: '0', lost_quantity: '0', version: 1,
        }, scale);
        await manager.query(
          `INSERT INTO stock_movement
             (balance_id,movement_type,delta_on_hand,delta_reserved,commitment_id,operation_ref,actor_user_id)
           VALUES ($1,'RESERVE',0,$2::numeric,$3,$4,$5)`,
          [balance.id, quantity, id, `COMMITMENT_RESERVE:${id}`, session.userId],
        );
        await auditCommitment(manager, session.userId, 'COMMITMENT_CREATED', id, null, value, null);
        return { status: 201, value, resource: { type: 'commitment', id } };
      },
      replay: async (manager, resource: ResourceRef | null) => {
        if (resource?.type !== 'commitment') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const row = await readCommitmentContext(manager, resource.id);
        const currentWarehouse = await loadWarehouse(manager, row.warehouse_id);
        assertWarehouseScope(session.grants, currentWarehouse, row.organization_id);
        return commitmentValue(row, Number(row.unit_scale));
      },
    });
  }

  async release(
    commitmentId: string,
    dto: ReleaseCommitmentDto,
    request: NeedCommandRequest,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = needCommandKey(request);
    const context = await readCommitmentContext(this.dataSource, commitmentId);
    const warehouse = await loadWarehouse(this.dataSource, context.warehouse_id);
    assertWarehouseScope(session.grants, warehouse, context.organization_id);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.commitments.release',
      key,
      requestHash: canonicalRequestHash({ commitment_id: commitmentId, dto }),
      execute: async (manager) => {
        const needCycle = await manager.query(
          'SELECT cycle_id FROM relief_need WHERE id=$1',
          [context.relief_need_id],
        ) as Array<{ cycle_id: string }>;
        if (!needCycle[0]) throw new AppError('NOT_FOUND', { status: 404 });
        const cycle = await lockCycle(manager, needCycle[0].cycle_id);
        assertReleaseCycle(cycle);
        const need = await lockNeed(manager, context.relief_need_id, cycle.id);
        const lockedWarehouse = await loadWarehouse(manager, context.warehouse_id);
        assertWarehouseScope(session.grants, lockedWarehouse, cycle.organization_id);
        const commitments = await lockCommitments(manager, need.id);
        const row = commitments.find((item) => item.id === commitmentId);
        if (!row) throw new AppError('NOT_FOUND', { status: 404 });
        const scale = Number(need.unit_scale);
        if (Number(row.version) !== dto.expected_version) {
          throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(row.version) } });
        }
        const quantity = validateQuantity(dto.quantity, scale);
        const requested = quantityUnits(quantity, scale);
        const unissuedReserved = quantityUnits(row.quantity, scale) - quantityUnits(row.released_quantity, scale) - quantityUnits(row.issued_quantity, scale);
        if (unissuedReserved < 0n) throw new AppError('INTERNAL_ERROR', { status: 500 });
        if (requested > unissuedReserved) throw new AppError('VALIDATION_FAILED', { status: 400 });

        const balances = await manager.query(
          `SELECT id,warehouse_id,item_id,on_hand::text,reserved::text FROM stock_balance
            WHERE warehouse_id=$1 AND item_id=$2 ORDER BY warehouse_id,item_id`,
          [row.warehouse_id, need.item_id],
        ) as BalanceRow[];
        const balance = balances[0];
        if (!balance || quantityUnits(balance.reserved, scale) < requested) throw new AppError('INTERNAL_ERROR', { status: 500 });

        const before = commitmentValue(row, scale);
        const updated = await manager.query(
          `UPDATE commitment SET released_quantity=released_quantity+$2::numeric,version=version+1
            WHERE id=$1 AND version=$3 RETURNING id`,
          [commitmentId, quantity, dto.expected_version],
        ) as Array<{ id: string }>;
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const afterRow = {
          ...row,
          released_quantity: decimalFromUnits(quantityUnits(row.released_quantity, scale) + requested, scale),
          version: Number(row.version) + 1,
        };
        const value = commitmentValue(afterRow, scale);
        await manager.query(
          `INSERT INTO stock_movement
             (balance_id,movement_type,delta_on_hand,delta_reserved,commitment_id,operation_ref,actor_user_id)
           VALUES ($1,'RELEASE',0,-$2::numeric,$3,$4,$5)`,
          [balance.id, quantity, commitmentId, `COMMITMENT_RELEASE:${commitmentId}:${dto.expected_version}`, session.userId],
        );
        await auditCommitment(manager, session.userId, 'COMMITMENT_RELEASED', commitmentId, before, value, dto.reason);
        return { status: 200, value, resource: { type: 'commitment', id: commitmentId } };
      },
      replay: async (manager, resource: ResourceRef | null) => {
        if (resource?.type !== 'commitment') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const row = await readCommitmentContext(manager, resource.id);
        const currentWarehouse = await loadWarehouse(manager, row.warehouse_id);
        assertWarehouseScope(session.grants, currentWarehouse, row.organization_id);
        return commitmentValue(row, Number(row.unit_scale));
      },
    });
  }

  private assertCampaign(failure: unknown, campaign: ResponseCampaign | null, cycle: CycleRow): void {
    if (failure !== undefined) throw failure;
    if (!cycle.campaign_id) return;
    if (!campaign || campaign.id !== cycle.campaign_id) throw new AppError('RESPONSE_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
    if (campaign.status === 'PAUSED') throw new AppError('CAMPAIGN_PAUSED', { status: 409 });
    if (campaign.status !== 'ACTIVE') throw new AppError('CAMPAIGN_NOT_ACTIVE', { status: 409 });
    if (campaign.organization_id !== cycle.organization_id) throw new AppError('VALIDATION_FAILED', { status: 400 });
  }
}
