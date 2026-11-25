import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { requireIdempotencyKey } from '@c48/technical/http/response-headers';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { decimalFromUnits, quantityUnits } from '../common/quantity';
import { NeedCommitmentsService } from '../needs/need-commitments.service';
import { DistributionCommandsService } from '../distributions/distribution-commands.service';
import { LogisticsResponseMissionClient, ResponseMission } from '../integrations/response/response-mission.client';
import { unmetUnits } from '../supply-gaps/supply-gap.calculator';
import { hasWarehouseScope, requireWarehousePermission } from '../stock/stock.scope';
import {
  CancelPickupTicketDto, CreatePickupTicketDto, HandoverPickupTicketDto, PickupExpectedVersionDto,
} from './pickup-tickets.dto';
import {
  PICKUP_ASSIGNABLE_MISSION_STATUSES, PickupLineRow, PickupRequest, PickupTicketRow, requirePickupPermission,
  stepRequest, ticketState, ticketView, writePickupAudit,
} from './pickup-tickets.helpers';

interface LiveNeedRow {
  relief_need_id: string;
  item_id: string;
  requested_quantity: string;
  unit_scale: number | string;
  committed: string;
}

const liveNeedStatuses = ['OPEN', 'PARTIALLY_FULFILLED'];

/**
 * Pickup ticket facade (proposal section 3.7). It hides the need, commitment and distribution steps behind one ticket per
 * mission. It never computes stock itself: each step calls the existing NeedCommitmentsService or
 * DistributionCommandsService with the caller's session, so their permissions, scope, version checks and stock movements
 * apply unchanged. Each step gets a deterministic idempotency key derived from the outer command key.
 *
 * Separation of duties: reserve creates the commitments and the DRAFT distribution (the reserving user is the preparer),
 * confirm approves it (the confirming user must differ from the preparer), and handover dispatches it (the dispatcher must
 * hold DISTRIBUTION_DISPATCH; since 2026-11-25 it may be the approver). A volunteer never needs a staff permission: a dispatcher may
 * record the volunteer who collected the goods in collected_by_user_id.
 */
@Injectable()
export class PickupTicketsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: LogisticsSessionService,
    private readonly missions: LogisticsResponseMissionClient,
    private readonly commitments: NeedCommitmentsService,
    private readonly distributions: DistributionCommandsService,
  ) {}

  async create(dto: CreatePickupTicketDto, request: PickupRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = requireIdempotencyKey(request);
    const mission = await this.missions.getMission(dto.mission_id);
    if (!(PICKUP_ASSIGNABLE_MISSION_STATUSES as readonly string[]).includes(mission.status)) {
      throw new AppError('PICKUP_MISSION_NOT_ASSIGNABLE', { status: 409 });
    }
    requirePickupPermission(session.grants, 'PICKUP_TICKET_MANAGE', mission.campaign_id);
    const warehouseId = await this.resolveWarehouse(mission, dto.warehouse_id);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.pickup-tickets.create',
      key,
      requestHash: canonicalRequestHash({ mission_id: mission.id, warehouse_id: warehouseId }),
      databaseErrorMappings: { unique: { pickup_ticket_mission_id_key: 'PICKUP_TICKET_EXISTS' } },
      execute: async (manager) => {
        const existing = await manager.query('SELECT id FROM pickup_ticket WHERE mission_id=$1', [mission.id]) as Array<{ id: string }>;
        if (existing[0]) throw new AppError('PICKUP_TICKET_EXISTS', { status: 409 });
        const needs = await this.liveNeeds(manager, mission);
        if (needs.length === 0) throw new AppError('PICKUP_NO_NEEDS', { status: 409 });

        const inserted = await manager.query(
          `INSERT INTO pickup_ticket (mission_id,request_id,campaign_id,team_id,warehouse_id)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [mission.id, mission.request_id, mission.campaign_id, mission.team_id, warehouseId],
        ) as Array<{ id: string }>;
        const id = inserted[0]?.id;
        if (!id) throw new AppError('INTERNAL_ERROR', { status: 500 });
        for (const need of needs) {
          const scale = Number(need.unit_scale);
          const unmet = unmetUnits(quantityUnits(need.requested_quantity, scale), quantityUnits(need.committed, scale));
          await manager.query(
            `INSERT INTO pickup_ticket_line (ticket_id,relief_need_id,item_id,requested_quantity)
             VALUES ($1,$2,$3,$4::numeric)`,
            [id, need.relief_need_id, need.item_id, decimalFromUnits(unmet, scale)],
          );
        }
        const row = await this.loadTicket(manager, id);
        const value = await this.view(manager, row);
        await writePickupAudit(manager, session.userId, 'PICKUP_TICKET_CREATED', id, null, ticketState(row));
        return { status: 201, value, resource: { type: 'pickup_ticket', id } };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'pickup_ticket') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const row = await this.loadTicket(manager, resource.id);
        requirePickupPermission(session.grants, 'PICKUP_TICKET_MANAGE', row.campaign_id);
        return this.view(manager, row);
      },
    });
  }

  /** Reserves stock for every live need line at the ticket warehouse, then creates the DRAFT distribution for the reservations. */
  async reserve(id: string, dto: PickupExpectedVersionDto, request: PickupRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = requireIdempotencyKey(request);
    await this.assertTicketScope(this.dataSource, id, session.grants, 'PICKUP_TICKET_MANAGE');

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.pickup-tickets.reserve',
      key,
      requestHash: canonicalRequestHash({ ticket_id: id, dto }),
      execute: async (manager) => {
        const locked = await this.lockTicket(manager, id, session.grants, 'PICKUP_TICKET_MANAGE');
        assertVersion(locked, dto.expected_version);
        if (locked.status !== 'OPEN') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const lines = await this.lines(manager, id);
        let reservedAny = false;
        for (const line of lines) {
          const need = await this.reservableNeed(manager, line.relief_need_id);
          if (!need) continue;
          const scale = Number(line.unit_scale);
          const unmet = unmetUnits(quantityUnits(need.requested_quantity, scale), quantityUnits(need.committed, scale));
          const target = minUnits(quantityUnits(line.requested_quantity, scale), unmet);
          const available = await this.availableUnits(manager, locked.warehouse_id, line.item_id, scale);
          const quantity = minUnits(target, available);
          if (quantity <= 0n) continue;
          const created = await this.commitments.create(
            line.relief_need_id,
            { warehouse_id: locked.warehouse_id, quantity: decimalFromUnits(quantity, scale) },
            stepRequest(request, `reserve:${line.relief_need_id}`),
          );
          const commitmentId = (created.value as { id: string }).id;
          await manager.query(
            `UPDATE pickup_ticket_line SET commitment_id=$3,reserved_quantity=$4::numeric
              WHERE ticket_id=$1 AND relief_need_id=$2`,
            [id, line.relief_need_id, commitmentId, decimalFromUnits(quantity, scale)],
          );
          reservedAny = true;
        }
        if (!reservedAny) throw new AppError('PICKUP_NOTHING_RESERVABLE', { status: 409 });

        const reserved = (await this.lines(manager, id)).filter((line) => line.commitment_id !== null);
        const distribution = await this.distributions.create({
          warehouse_id: locked.warehouse_id,
          ...(locked.campaign_id ? { campaign_id: locked.campaign_id } : {}),
          purpose: 'REQUEST_AID',
          lines: reserved.map((line) => ({
            item_id: line.item_id,
            commitment_id: line.commitment_id as string,
            quantity: line.reserved_quantity,
          })),
        }, stepRequest(request, 'distribution'));
        const distributionId = (distribution.value as { id: string }).id;

        const before = ticketState(locked);
        const updated = await manager.query(
          `UPDATE pickup_ticket SET status='READY',distribution_id=$2,reserved_by=$3,ready_at=clock_timestamp(),
                  version=version+1,updated_at=clock_timestamp()
            WHERE id=$1 AND version=$4 AND status='OPEN' RETURNING id`,
          [id, distributionId, session.userId, dto.expected_version],
        ) as Array<{ id: string }>;
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const row = await this.loadTicket(manager, id);
        const value = await this.view(manager, row, { withBackups: true });
        await writePickupAudit(manager, session.userId, 'PICKUP_TICKET_RESERVED', id, before, ticketState(row));
        return { status: 200, value, resource: { type: 'pickup_ticket', id } };
      },
      replay: (manager, resource) => this.replay(manager, resource, session.grants, 'PICKUP_TICKET_MANAGE', { withBackups: true }),
    });
  }

  /** Approves the reserved distribution. The confirming user is the approver; the existing rule rejects the preparer. */
  async confirm(id: string, dto: PickupExpectedVersionDto, request: PickupRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = requireIdempotencyKey(request);
    await this.assertTicketScope(this.dataSource, id, session.grants, 'PICKUP_TICKET_MANAGE');

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.pickup-tickets.confirm',
      key,
      requestHash: canonicalRequestHash({ ticket_id: id, dto }),
      execute: async (manager) => {
        const locked = await this.lockTicket(manager, id, session.grants, 'PICKUP_TICKET_MANAGE');
        assertVersion(locked, dto.expected_version);
        if (locked.status !== 'READY' || locked.confirmed_at !== null) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const distribution = await this.distributionOf(manager, locked);
        if (distribution.status !== 'DRAFT') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        await this.distributions.approve(
          distribution.id,
          { expected_version: Number(distribution.version) },
          stepRequest(request, 'approve'),
        );
        const before = ticketState(locked);
        const updated = await manager.query(
          `UPDATE pickup_ticket SET confirmed_by=$2,confirmed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
            WHERE id=$1 AND version=$3 AND status='READY' AND confirmed_at IS NULL RETURNING id`,
          [id, session.userId, dto.expected_version],
        ) as Array<{ id: string }>;
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const row = await this.loadTicket(manager, id);
        await writePickupAudit(manager, session.userId, 'PICKUP_TICKET_CONFIRMED', id, before, ticketState(row));
        return { status: 200, value: await this.view(manager, row), resource: { type: 'pickup_ticket', id } };
      },
      replay: (manager, resource) => this.replay(manager, resource, session.grants, 'PICKUP_TICKET_MANAGE'),
    });
  }

  /**
   * Dispatches the distribution (issues stock through the existing dispatch) and moves the goods into team custody.
   * Dispatch runs in its own transaction; the custody credit is in the same transaction as the HANDED_OVER transition,
   * which only succeeds from READY, so a retry cannot credit twice.
   */
  async handover(id: string, dto: HandoverPickupTicketDto, request: PickupRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = requireIdempotencyKey(request);
    const current = await this.assertTicketScope(this.dataSource, id, session.grants, 'DISTRIBUTION_DISPATCH');
    // Cross-service check before the Logistics transaction starts (same rule as the fulfillment-cycle intents).
    if (dto.collected_by_user_id) await this.assertCollectorMember(current, dto.collected_by_user_id);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.pickup-tickets.handover',
      key,
      requestHash: canonicalRequestHash({ ticket_id: id, dto }),
      databaseErrorMappings: { check: { stock_balance_check: 'INSUFFICIENT_STOCK' } },
      execute: async (manager) => {
        const locked = await this.lockTicket(manager, id, session.grants, 'DISTRIBUTION_DISPATCH');
        assertVersion(locked, dto.expected_version);
        if (locked.status !== 'READY') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (!locked.confirmed_at) throw new AppError('PICKUP_NOT_CONFIRMED', { status: 409 });
        const distribution = await this.distributionOf(manager, locked);
        // approved_version is stable across dispatch (dispatch bumps version only), so a retry sends the same request hash.
        await this.distributions.dispatch(
          distribution.id,
          { expected_version: Number(distribution.approved_version) },
          stepRequest(request, 'dispatch'),
        );
        const before = ticketState(locked);
        const updated = await manager.query(
          `UPDATE pickup_ticket SET status='HANDED_OVER',handed_over_by=$2,handed_over_at=clock_timestamp(),
                  collected_by_user_id=$3,version=version+1,updated_at=clock_timestamp()
            WHERE id=$1 AND version=$4 AND status='READY' RETURNING id`,
          [id, session.userId, dto.collected_by_user_id ?? null, dto.expected_version],
        ) as Array<{ id: string }>;
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        await manager.query(
          `INSERT INTO team_custody (team_id,item_id,quantity_held)
           SELECT $1::uuid, dl.item_id, SUM(dl.quantity) FROM distribution_line dl WHERE dl.distribution_id=$2 GROUP BY dl.item_id
           ON CONFLICT (team_id,item_id) DO UPDATE
             SET quantity_held = team_custody.quantity_held + EXCLUDED.quantity_held, updated_at = clock_timestamp()`,
          [locked.team_id, distribution.id],
        );
        const row = await this.loadTicket(manager, id);
        await writePickupAudit(manager, session.userId, 'PICKUP_TICKET_HANDED_OVER', id, before, ticketState(row));
        return { status: 200, value: await this.view(manager, row), resource: { type: 'pickup_ticket', id } };
      },
      replay: (manager, resource) => this.replay(manager, resource, session.grants, 'DISTRIBUTION_DISPATCH'),
    });
  }

  /** Cancels an OPEN or READY ticket. READY cancellation cancels the draft and releases the unissued reservations. */
  async cancel(id: string, dto: CancelPickupTicketDto, request: PickupRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = requireIdempotencyKey(request);
    await this.assertTicketScope(this.dataSource, id, session.grants, 'PICKUP_TICKET_MANAGE');

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.pickup-tickets.cancel',
      key,
      requestHash: canonicalRequestHash({ ticket_id: id, dto }),
      execute: async (manager) => {
        const locked = await this.lockTicket(manager, id, session.grants, 'PICKUP_TICKET_MANAGE');
        assertVersion(locked, dto.expected_version);
        if (locked.status !== 'OPEN' && locked.status !== 'READY') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (locked.status === 'READY' && locked.distribution_id) {
          const distribution = await this.distributionOf(manager, locked);
          if (distribution.status === 'DISPATCHED' || distribution.status === 'RECONCILED') throw new AppError('ALREADY_DISPATCHED', { status: 409 });
          if (distribution.status === 'DRAFT' || distribution.status === 'APPROVED') {
            // The existing rule applies: only the preparer or the approver may cancel the draft.
            await this.distributions.cancel(distribution.id, { expected_version: Number(distribution.version) }, stepRequest(request, 'cancel-distribution'));
          }
          for (const line of await this.lines(manager, id)) {
            if (!line.commitment_id) continue;
            const commitment = await this.commitmentRemaining(manager, line.commitment_id, Number(line.unit_scale));
            if (commitment.remaining <= 0n) continue;
            await this.commitments.release(
              line.commitment_id,
              { expected_version: commitment.version, quantity: decimalFromUnits(commitment.remaining, Number(line.unit_scale)), reason: dto.reason },
              stepRequest(request, `release:${line.commitment_id}`),
            );
          }
        }
        const before = ticketState(locked);
        const updated = await manager.query(
          `UPDATE pickup_ticket SET status='CANCELLED',cancelled_at=clock_timestamp(),cancel_reason=$2,
                  version=version+1,updated_at=clock_timestamp()
            WHERE id=$1 AND version=$3 AND status IN ('OPEN','READY') RETURNING id`,
          [id, dto.reason, dto.expected_version],
        ) as Array<{ id: string }>;
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const row = await this.loadTicket(manager, id);
        await writePickupAudit(manager, session.userId, 'PICKUP_TICKET_CANCELLED', id, before, ticketState(row), dto.reason);
        return { status: 200, value: await this.view(manager, row), resource: { type: 'pickup_ticket', id } };
      },
      replay: (manager, resource) => this.replay(manager, resource, session.grants, 'PICKUP_TICKET_MANAGE'),
    });
  }

  private async resolveWarehouse(mission: ResponseMission, requested: string | undefined): Promise<string> {
    if (requested) {
      const rows = await this.dataSource.query('SELECT id FROM warehouse WHERE id=$1', [requested]) as Array<{ id: string }>;
      if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
      if (mission.campaign_id) {
        const assigned = await this.dataSource.query(
          'SELECT 1 FROM campaign_warehouse WHERE campaign_id=$1 AND warehouse_id=$2',
          [mission.campaign_id, requested],
        ) as unknown[];
        if (assigned.length === 0) throw new AppError('WAREHOUSE_NOT_ELIGIBLE', { status: 409 });
      }
      return requested;
    }
    if (!mission.campaign_id) throw new AppError('PICKUP_NO_PRIMARY_WAREHOUSE', { status: 409 });
    const rows = await this.dataSource.query(
      `SELECT warehouse_id FROM campaign_warehouse WHERE campaign_id=$1 AND role='PRIMARY'`,
      [mission.campaign_id],
    ) as Array<{ warehouse_id: string }>;
    if (!rows[0]) throw new AppError('PICKUP_NO_PRIMARY_WAREHOUSE', { status: 409 });
    return rows[0].warehouse_id;
  }

  private async liveNeeds(manager: EntityManager, mission: ResponseMission): Promise<LiveNeedRow[]> {
    const rows = await manager.query(
      `SELECT n.id AS relief_need_id,n.item_id,n.requested_quantity::text,u.scale AS unit_scale,
              COALESCE((SELECT SUM(cm.quantity-cm.released_quantity-cm.returned_quantity-cm.lost_quantity)::text
                          FROM commitment cm WHERE cm.relief_need_id=n.id),'0') AS committed
         FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id
         JOIN item i ON i.id=n.item_id JOIN unit u ON u.code=i.unit_code
        WHERE c.request_id=$1 AND c.work_cycle=$2 AND n.source IN ('DECLARED','CONFIRMED') AND n.status = ANY($3::text[])
        ORDER BY n.id`,
      [mission.request_id, mission.work_cycle, liveNeedStatuses],
    ) as LiveNeedRow[];
    return rows;
  }

  private async reservableNeed(manager: EntityManager, needId: string): Promise<LiveNeedRow | null> {
    const rows = await manager.query(
      `SELECT n.id AS relief_need_id,n.item_id,n.requested_quantity::text,u.scale AS unit_scale,n.status,n.source,
              COALESCE((SELECT SUM(cm.quantity-cm.released_quantity-cm.returned_quantity-cm.lost_quantity)::text
                          FROM commitment cm WHERE cm.relief_need_id=n.id),'0') AS committed
         FROM relief_need n JOIN item i ON i.id=n.item_id JOIN unit u ON u.code=i.unit_code WHERE n.id=$1`,
      [needId],
    ) as Array<LiveNeedRow & { status: string; source: string }>;
    const row = rows[0];
    if (!row || !liveNeedStatuses.includes(row.status) || row.source === 'ESTIMATED') return null;
    return row;
  }

  private async availableUnits(manager: EntityManager, warehouseId: string, itemId: string, scale: number): Promise<bigint> {
    const rows = await manager.query(
      'SELECT on_hand::text,reserved::text FROM stock_balance WHERE warehouse_id=$1 AND item_id=$2',
      [warehouseId, itemId],
    ) as Array<{ on_hand: string; reserved: string }>;
    const row = rows[0];
    if (!row) return 0n;
    const free = quantityUnits(row.on_hand, scale) - quantityUnits(row.reserved, scale);
    return free > 0n ? free : 0n;
  }

  private async commitmentRemaining(manager: EntityManager, commitmentId: string, scale: number): Promise<{ version: number; remaining: bigint }> {
    const rows = await manager.query(
      // No row lock here: release() locks the same commitment in its own transaction, so an outer lock would self-deadlock.
      'SELECT version,quantity::text,released_quantity::text,issued_quantity::text FROM commitment WHERE id=$1',
      [commitmentId],
    ) as Array<{ version: number | string; quantity: string; released_quantity: string; issued_quantity: string }>;
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { status: 404 });
    const remaining = quantityUnits(row.quantity, scale) - quantityUnits(row.released_quantity, scale) - quantityUnits(row.issued_quantity, scale);
    return { version: Number(row.version), remaining: remaining > 0n ? remaining : 0n };
  }

  private async loadTicket(manager: Pick<EntityManager, 'query'>, id: string, forUpdate = false): Promise<PickupTicketRow> {
    const rows = await manager.query(
      `SELECT id,mission_id,request_id,campaign_id,team_id,warehouse_id,status,distribution_id,ready_at,reserved_by,
              confirmed_by,confirmed_at,handed_over_by,handed_over_at,collected_by_user_id,cancelled_at,cancel_reason,
              version,created_at,updated_at
         FROM pickup_ticket WHERE id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
      [id],
    ) as PickupTicketRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private async lockTicket(
    manager: EntityManager,
    id: string,
    grants: Parameters<typeof hasWarehouseScope>[0],
    permission: Parameters<typeof requirePickupPermission>[1],
  ): Promise<PickupTicketRow> {
    const row = await this.loadTicket(manager, id, true);
    if (!hasWarehouseScope(grants, { campaign_id: row.campaign_id })) throw new AppError('NOT_FOUND', { status: 404 });
    requirePickupPermission(grants, permission, row.campaign_id);
    return row;
  }

  private async assertTicketScope(
    source: Pick<DataSource | EntityManager, 'query'>,
    id: string,
    grants: Parameters<typeof hasWarehouseScope>[0],
    permission: Parameters<typeof requirePickupPermission>[1],
  ): Promise<PickupTicketRow> {
    const row = await this.loadTicket(source, id);
    if (!hasWarehouseScope(grants, { campaign_id: row.campaign_id })) throw new AppError('NOT_FOUND', { status: 404 });
    requireWarehousePermission(grants, permission, { campaign_id: row.campaign_id });
    return row;
  }

  private async assertCollectorMember(row: PickupTicketRow, userId: string): Promise<void> {
    const mission = await this.missions.getMission(row.mission_id);
    if (!mission.member_user_ids.includes(userId)) throw new AppError('PICKUP_COLLECTOR_NOT_MEMBER', { status: 409 });
  }

  private async distributionOf(manager: EntityManager, row: PickupTicketRow): Promise<{ id: string; status: string; version: number; approved_version: number }> {
    if (!row.distribution_id) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const rows = await manager.query(
      'SELECT id,status,version,approved_version FROM distribution WHERE id=$1',
      [row.distribution_id],
    ) as Array<{ id: string; status: string; version: number | string; approved_version: number | string | null }>;
    const found = rows[0];
    if (!found) throw new AppError('NOT_FOUND', { status: 404 });
    return { id: found.id, status: found.status, version: Number(found.version), approved_version: Number(found.approved_version ?? found.version) };
  }

  private async lines(manager: EntityManager, ticketId: string): Promise<PickupLineRow[]> {
    const rows = await manager.query(
      `SELECT l.ticket_id,l.relief_need_id,l.commitment_id,l.item_id,i.name AS item_name,i.unit_code,u.scale AS unit_scale,
              l.requested_quantity::text,l.reserved_quantity::text
         FROM pickup_ticket_line l JOIN item i ON i.id=l.item_id JOIN unit u ON u.code=i.unit_code
        WHERE l.ticket_id=$1 ORDER BY l.relief_need_id`,
      [ticketId],
    ) as PickupLineRow[];
    return rows;
  }

  private async view(manager: EntityManager, row: PickupTicketRow, options: { withBackups?: boolean } = {}): Promise<Record<string, unknown>> {
    const lines = await this.lines(manager, row.id);
    const value = ticketView(row, lines);
    if (!options.withBackups) return value;
    return { ...value, backup_warehouses: await this.backupHints(manager, row, lines) };
  }

  /** Informational only: BACKUP warehouses of the campaign that hold free stock for a shortfall item. Nothing moves automatically. */
  private async backupHints(manager: EntityManager, row: PickupTicketRow, lines: readonly PickupLineRow[]): Promise<Array<Record<string, unknown>>> {
    const shortItems = [...new Set(lines.filter((line) => quantityUnits(line.reserved_quantity, Number(line.unit_scale)) < quantityUnits(line.requested_quantity, Number(line.unit_scale))).map((line) => line.item_id))];
    if (!row.campaign_id || shortItems.length === 0) return [];
    const rows = await manager.query(
      `SELECT cw.warehouse_id,sb.item_id,(sb.on_hand-sb.reserved)::text AS available,u.scale AS unit_scale
         FROM campaign_warehouse cw JOIN stock_balance sb ON sb.warehouse_id=cw.warehouse_id
         JOIN item i ON i.id=sb.item_id JOIN unit u ON u.code=i.unit_code
        WHERE cw.campaign_id=$1 AND cw.role='BACKUP' AND sb.item_id=ANY($2::uuid[]) AND sb.on_hand>sb.reserved
        ORDER BY sb.item_id,cw.warehouse_id`,
      [row.campaign_id, shortItems],
    ) as Array<{ warehouse_id: string; item_id: string; available: string; unit_scale: number }>;
    return rows.map((hint) => ({
      warehouse_id: hint.warehouse_id,
      item_id: hint.item_id,
      available_quantity: decimalFromUnits(quantityUnits(hint.available, Number(hint.unit_scale)), Number(hint.unit_scale)),
    }));
  }

  private async replay(
    manager: EntityManager,
    resource: { type: string; id: string } | null,
    grants: Parameters<typeof hasWarehouseScope>[0],
    permission: Parameters<typeof requirePickupPermission>[1],
    options: { withBackups?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    if (resource?.type !== 'pickup_ticket') throw new AppError('INTERNAL_ERROR', { status: 500 });
    const row = await this.loadTicket(manager, resource.id);
    if (!hasWarehouseScope(grants, { campaign_id: row.campaign_id })) throw new AppError('NOT_FOUND', { status: 404 });
    requirePickupPermission(grants, permission, row.campaign_id);
    return this.view(manager, row, options);
  }
}

function assertVersion(row: PickupTicketRow, expected: number): void {
  if (Number(row.version) !== expected) throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(row.version) } });
}

function minUnits(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}
