import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { requireIdempotencyKey } from '@c48/technical/http/response-headers';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { decimalFromUnits, quantityUnits, validateQuantity } from '../common/quantity';
import { LogisticsResponseMissionClient, ResponseMission } from '../integrations/response/response-mission.client';
import { lockCycle } from '../needs/need-estimate-batch';
import { readNeed, writeNeedAudit } from '../needs/needs.helpers';
import { ResponseAdmission, ResponseAdmissionClient } from '../needs/response-admission.client';
import { CancelSupplyRequestDto, CreateSupplyRequestDto, HandOverSupplyRequestDto } from './supply-requests.dto';
import {
  chooseWarehouse, loadSupplyLines, loadSupplyRequest, needStatus, newPickupCode, releaseSupplyReservations, requestState,
  requireHandover, SUPPLY_MISSION_STATUSES, SUPPLY_REQUEST_EXPIRY_HOURS, supplyActor, SupplyRequestCommand, SupplyRequestRow,
  teamView, WantedLine, WarehouseCandidate, warehouseQueueView, writeSupplyAudit,
} from './supply-requests.helpers';

interface ItemRow {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  scale: number | string;
}

interface NeedLockRow {
  id: string;
  item_id: string;
  requested_quantity: string;
  status: 'OPEN' | 'PARTIALLY_FULFILLED' | 'FULFILLED' | 'CANCELLED';
  source: 'DECLARED' | 'ESTIMATED' | 'CONFIRMED';
  version: number | string;
}

interface CommitmentTotals {
  delivered: bigint;
  reserved: bigint;
}

/**
 * Supply requests (user decision 2026-11-26): the only way goods leave a warehouse for a mission.
 *
 * create  — the team leader (or a coordinator on behalf) lists goods; the system confirms the SOS needs, picks one
 *           warehouse, reserves what it holds and gives a six-digit pickup code. No approval step.
 * handOver — warehouse staff type the team's code; the reserved goods are issued and counted as delivered to the SOS.
 * cancel  — the team, the coordinator or the warehouse cancels an open request; the reservation is released.
 * Expiry is handled by SupplyRequestExpiryService.
 */
@Injectable()
export class SupplyRequestsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: LogisticsSessionService,
    private readonly missions: LogisticsResponseMissionClient,
    private readonly admission: ResponseAdmissionClient,
  ) {}

  async create(dto: CreateSupplyRequestDto, request: SupplyRequestCommand): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = requireIdempotencyKey(request);
    const itemIds = dto.lines.map((line) => line.item_id);
    if (new Set(itemIds).size !== itemIds.length) throw new AppError('SUPPLY_DUPLICATE_ITEM', { status: 400 });

    const idempotent = {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.supply-requests.create',
      key,
      requestHash: canonicalRequestHash({ dto }),
    };
    const replay = async (manager: EntityManager, resource: { type: string; id: string } | null): Promise<Record<string, unknown>> => {
      if (resource?.type !== 'supply_request') throw new AppError('INTERNAL_ERROR', { status: 500 });
      const row = await loadSupplyRequest(manager, resource.id);
      if (row.requested_by !== session.userId) throw new AppError('NOT_FOUND', { status: 404 });
      return teamView(row, await loadSupplyLines(manager, [row.id]));
    };

    // Cross-service reads finish before the Logistics transaction starts.
    let mission: ResponseMission;
    let admission: ResponseAdmission;
    let onBehalf: boolean;
    try {
      mission = await this.missions.getMission(dto.mission_id);
      if (!(SUPPLY_MISSION_STATUSES as readonly string[]).includes(mission.status)) {
        throw new AppError('SUPPLY_MISSION_NOT_ACTIVE', { status: 409 });
      }
      onBehalf = supplyActor(session.grants, session.userId, mission).onBehalf;
      admission = await this.admission.admit(mission.request_id, mission.work_cycle, session.identityHeaders);
    } catch (error) {
      return this.idempotency.execute(this.dataSource, { ...idempotent, execute: async () => { throw error; }, replay });
    }

    return this.idempotency.execute(this.dataSource, {
      ...idempotent,
      databaseErrorMappings: {
        unique: {
          supply_request_live_mission_uq: 'SUPPLY_REQUEST_EXISTS',
          supply_request_live_code_uq: 'SUPPLY_CODE_BUSY',
        },
        check: { stock_balance_check: 'INSUFFICIENT_STOCK' },
      },
      execute: async (manager) => {
        const cycle = await lockCycle(manager, admission);
        // No row lock here: hand-over and cancel lock the request before the cycle, so locking it after the cycle could
        // deadlock. The partial unique index supply_request_live_mission_uq is the guard against a concurrent create.
        const open = await manager.query(
          "SELECT id FROM supply_request WHERE mission_id=$1 AND status='READY'",
          [mission.id],
        ) as Array<{ id: string }>;
        if (open[0]) throw new AppError('SUPPLY_REQUEST_EXISTS', { status: 409 });

        const items = await this.loadItems(manager, itemIds);
        const wanted: Array<WantedLine & { scale: number; quantity: string }> = dto.lines.map((line) => {
          const item = items.get(line.item_id);
          if (!item || item.status !== 'ACTIVE') throw new AppError('ITEM_NOT_ACTIVE', { status: 409 });
          const scale = Number(item.scale);
          const quantity = validateQuantity(line.quantity, scale);
          return { item_id: line.item_id, units: quantityUnits(quantity, scale), scale, quantity };
        });

        const candidates = await this.warehouseCandidates(manager, mission.campaign_id, itemIds, items);
        const warehouse = chooseWarehouse(candidates, wanted);
        if (!warehouse) throw new AppError('SUPPLY_NO_STOCK', { status: 409 });

        const code = await this.freeCode(manager);
        const inserted = await manager.query(
          `INSERT INTO supply_request (mission_id,request_id,work_cycle,campaign_id,team_id,team_name,warehouse_id,pickup_code,
                                       requested_by,on_behalf,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,clock_timestamp() + make_interval(hours => $11::int)) RETURNING id`,
          [mission.id, mission.request_id, mission.work_cycle, cycle.campaign_id, mission.team_id, mission.team_name.trim() || 'Đội cứu hộ',
            warehouse.id, code, session.userId, onBehalf, SUPPLY_REQUEST_EXPIRY_HOURS],
        ) as Array<{ id: string }>;
        const id = inserted[0]?.id;
        if (!id) throw new AppError('INTERNAL_ERROR', { status: 500 });

        for (const line of [...wanted].sort((left, right) => left.item_id.localeCompare(right.item_id))) {
          const needId = await this.confirmNeed(manager, cycle.id, line, session.userId);
          const free = warehouse.free.get(line.item_id) ?? 0n;
          const reserve = free >= line.units ? line.units : free > 0n ? free : 0n;
          const commitmentId = reserve > 0n
            ? await this.reserve(manager, needId, line.item_id, warehouse.id, decimalFromUnits(reserve, line.scale), session.userId)
            : null;
          await manager.query(
            `INSERT INTO supply_request_line (supply_request_id,item_id,relief_need_id,commitment_id,requested_quantity,reserved_quantity)
             VALUES ($1,$2,$3,$4,$5::numeric,$6::numeric)`,
            [id, line.item_id, needId, commitmentId, line.quantity, decimalFromUnits(reserve, line.scale)],
          );
        }

        const row = await loadSupplyRequest(manager, id);
        await writeSupplyAudit(manager, session.userId, 'SUPPLY_REQUEST_CREATED', id, null, requestState(row),
          onBehalf ? 'Điều phối viên yêu cầu thay đội' : null);
        return { status: 201, value: teamView(row, await loadSupplyLines(manager, [id])), resource: { type: 'supply_request', id } };
      },
      replay,
    });
  }

  /** The warehouse hands the reserved goods to the team that shows the matching code. */
  async handOver(id: string, dto: HandOverSupplyRequestDto, request: SupplyRequestCommand): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = requireIdempotencyKey(request);
    const current = await loadSupplyRequest(this.dataSource, id);
    requireHandover(session.grants, current.campaign_id);

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.supply-requests.hand-over',
      key,
      requestHash: canonicalRequestHash({ id, dto }),
      databaseErrorMappings: { check: { stock_balance_check: 'INSUFFICIENT_STOCK' } },
      execute: async (manager) => {
        const locked = await loadSupplyRequest(manager, id, true);
        requireHandover(session.grants, locked.campaign_id);
        assertVersion(locked, dto.expected_version);
        if (locked.status !== 'READY') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (new Date(locked.expires_at).getTime() <= Date.now()) throw new AppError('SUPPLY_REQUEST_EXPIRED', { status: 409 });
        if (locked.pickup_code !== dto.pickup_code) throw new AppError('SUPPLY_CODE_MISMATCH', { status: 409 });

        const lines = await loadSupplyLines(manager, [id]);
        let issuedAny = false;
        for (const line of lines) {
          if (!line.commitment_id) continue;
          if (await this.issueLine(manager, locked, line, session.userId)) issuedAny = true;
        }
        if (!issuedAny) throw new AppError('SUPPLY_NOTHING_TO_HAND_OVER', { status: 409 });

        const updated = await manager.query(
          `UPDATE supply_request SET status='HANDED_OVER',handed_over_by=$2,handed_over_at=clock_timestamp(),
                  version=version+1,updated_at=clock_timestamp()
            WHERE id=$1 AND version=$3 AND status='READY' RETURNING id`,
          [id, session.userId, dto.expected_version],
        ) as Array<{ id: string }>;
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const row = await loadSupplyRequest(manager, id);
        await writeSupplyAudit(manager, session.userId, 'SUPPLY_REQUEST_HANDED_OVER', id, requestState(locked), requestState(row));
        return { status: 200, value: warehouseQueueView(row, await loadSupplyLines(manager, [id])), resource: { type: 'supply_request', id } };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'supply_request') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const row = await loadSupplyRequest(manager, resource.id);
        requireHandover(session.grants, row.campaign_id);
        return warehouseQueueView(row, await loadSupplyLines(manager, [row.id]));
      },
    });
  }

  /** The team or coordinator (team view) or the warehouse (queue view) cancels an open request. */
  async cancel(id: string, dto: CancelSupplyRequestDto, request: SupplyRequestCommand): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = requireIdempotencyKey(request);
    const current = await loadSupplyRequest(this.dataSource, id);
    let asWarehouse = false;
    try {
      requireHandover(session.grants, current.campaign_id);
      asWarehouse = true;
    } catch {
      // Not warehouse staff: the caller must be the team leader or a coordinator of the mission.
    }
    if (!asWarehouse) supplyActor(session.grants, session.userId, await this.missions.getMission(current.mission_id));

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.supply-requests.cancel',
      key,
      requestHash: canonicalRequestHash({ id, dto }),
      execute: async (manager) => {
        const locked = await loadSupplyRequest(manager, id, true);
        assertVersion(locked, dto.expected_version);
        if (locked.status !== 'READY') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        await releaseSupplyReservations(manager, await loadSupplyLines(manager, [id]), session.userId, id);
        const updated = await manager.query(
          `UPDATE supply_request SET status='CANCELLED',cancelled_by=$2,cancelled_at=clock_timestamp(),cancel_reason=$3,
                  version=version+1,updated_at=clock_timestamp()
            WHERE id=$1 AND version=$4 AND status='READY' RETURNING id`,
          [id, session.userId, dto.reason.trim(), dto.expected_version],
        ) as Array<{ id: string }>;
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const row = await loadSupplyRequest(manager, id);
        await writeSupplyAudit(manager, session.userId, 'SUPPLY_REQUEST_CANCELLED', id, requestState(locked), requestState(row), dto.reason.trim());
        const lines = await loadSupplyLines(manager, [id]);
        return { status: 200, value: asWarehouse ? warehouseQueueView(row, lines) : teamView(row, lines), resource: { type: 'supply_request', id } };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'supply_request') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const row = await loadSupplyRequest(manager, resource.id);
        const lines = await loadSupplyLines(manager, [row.id]);
        return asWarehouse ? warehouseQueueView(row, lines) : teamView(row, lines);
      },
    });
  }

  private async loadItems(manager: EntityManager, ids: readonly string[]): Promise<Map<string, ItemRow>> {
    const rows = await manager.query(
      `SELECT i.id,i.name,i.status,u.scale FROM item i JOIN unit u ON u.code=i.unit_code WHERE i.id=ANY($1::uuid[]) FOR SHARE OF i`,
      [ids],
    ) as ItemRow[];
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** Active warehouses with their free stock for the requested items, tiered by the campaign assignment. */
  private async warehouseCandidates(
    manager: EntityManager,
    campaignId: string | null,
    itemIds: readonly string[],
    items: ReadonlyMap<string, ItemRow>,
  ): Promise<WarehouseCandidate[]> {
    const rows = await manager.query(
      `SELECT w.id,w.name,cw.role,sb.item_id,(sb.on_hand-sb.reserved)::text AS free
         FROM warehouse w
         LEFT JOIN campaign_warehouse cw ON cw.warehouse_id=w.id AND cw.campaign_id=$1::uuid
         JOIN stock_balance sb ON sb.warehouse_id=w.id AND sb.item_id=ANY($2::uuid[]) AND sb.on_hand>sb.reserved
        WHERE w.status='ACTIVE'
        ORDER BY w.id,sb.item_id`,
      [campaignId, itemIds],
    ) as Array<{ id: string; name: string; role: 'PRIMARY' | 'BACKUP' | null; item_id: string; free: string }>;
    const byWarehouse = new Map<string, WarehouseCandidate>();
    for (const row of rows) {
      const tier = row.role === 'PRIMARY' ? 0 : row.role === 'BACKUP' ? 1 : 2;
      const candidate = byWarehouse.get(row.id) ?? { id: row.id, name: row.name, tier, free: new Map<string, bigint>() };
      const item = items.get(row.item_id);
      if (item) candidate.free.set(row.item_id, quantityUnits(row.free, Number(item.scale)));
      byWarehouse.set(row.id, candidate);
    }
    return [...byWarehouse.values()];
  }

  /** A code not used by any open request. The partial unique index is the final guard against a concurrent pick. */
  private async freeCode(manager: EntityManager): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = newPickupCode();
      const used = await manager.query("SELECT 1 FROM supply_request WHERE pickup_code=$1 AND status='READY'", [code]) as unknown[];
      if (used.length === 0) return code;
    }
    throw new AppError('SUPPLY_CODE_BUSY', { status: 503, retryAfterSeconds: 1 });
  }

  /**
   * The team's request confirms the SOS need for the item: an estimate (AI or norm) becomes CONFIRMED, and the requested
   * quantity grows so that delivered + still reserved + this request fits. A missing need is created as CONFIRMED.
   */
  private async confirmNeed(
    manager: EntityManager,
    cycleId: string,
    line: WantedLine & { scale: number; quantity: string },
    actorId: string,
  ): Promise<string> {
    const rows = await manager.query(
      `SELECT id,item_id,requested_quantity::text,status,source,version FROM relief_need
        WHERE cycle_id=$1 AND item_id=$2 AND status<>'CANCELLED' FOR UPDATE`,
      [cycleId, line.item_id],
    ) as NeedLockRow[];
    const need = rows[0];
    if (!need) {
      const inserted = await manager.query(
        `INSERT INTO relief_need (cycle_id,item_id,original_quantity,requested_quantity,source)
         VALUES ($1,$2,$3::numeric,$3::numeric,'CONFIRMED') RETURNING id`,
        [cycleId, line.item_id, line.quantity],
      ) as Array<{ id: string }>;
      const id = inserted[0]?.id;
      if (!id) throw new AppError('INTERNAL_ERROR', { status: 500 });
      await writeNeedAudit(manager, actorId, 'NEED_REQUESTED_BY_TEAM', id, null, await readNeed(manager, id), null);
      return id;
    }

    const totals = await this.commitmentTotals(manager, need.id, line.scale);
    const requested = quantityUnits(need.requested_quantity, line.scale);
    const floor = totals.delivered + totals.reserved + line.units;
    const next = requested > floor ? requested : floor;
    if (next === requested && need.source !== 'ESTIMATED') return need.id;
    const before = await readNeed(manager, need.id);
    await manager.query(
      `UPDATE relief_need SET requested_quantity=$2::numeric,source='CONFIRMED',status=$3,version=version+1 WHERE id=$1`,
      [need.id, decimalFromUnits(next, line.scale), needStatus(totals.delivered, next)],
    );
    await writeNeedAudit(manager, actorId, 'NEED_REQUESTED_BY_TEAM', need.id, before, await readNeed(manager, need.id), null);
    return need.id;
  }

  private async commitmentTotals(manager: EntityManager, needId: string, scale: number): Promise<CommitmentTotals> {
    const rows = await manager.query(
      `SELECT quantity::text,released_quantity::text,issued_quantity::text,delivered_quantity::text
         FROM commitment WHERE relief_need_id=$1 ORDER BY id FOR UPDATE`,
      [needId],
    ) as Array<{ quantity: string; released_quantity: string; issued_quantity: string; delivered_quantity: string }>;
    return rows.reduce<CommitmentTotals>((sum, row) => ({
      delivered: sum.delivered + quantityUnits(row.delivered_quantity, scale),
      reserved: sum.reserved + quantityUnits(row.quantity, scale) - quantityUnits(row.released_quantity, scale) -
        quantityUnits(row.issued_quantity, scale),
    }), { delivered: 0n, reserved: 0n });
  }

  /** Reserves stock for one need at the chosen warehouse (commitment + RESERVE movement, the same shape as before). */
  private async reserve(
    manager: EntityManager,
    needId: string,
    itemId: string,
    warehouseId: string,
    quantity: string,
    actorId: string,
  ): Promise<string> {
    const balances = await manager.query(
      'SELECT id FROM stock_balance WHERE warehouse_id=$1 AND item_id=$2',
      [warehouseId, itemId],
    ) as Array<{ id: string }>;
    if (!balances[0]) throw new AppError('INSUFFICIENT_STOCK', { status: 409 });
    const inserted = await manager.query(
      `INSERT INTO commitment (relief_need_id,item_id,warehouse_id,quantity,created_by_user_id)
       VALUES ($1,$2,$3,$4::numeric,$5) RETURNING id`,
      [needId, itemId, warehouseId, quantity, actorId],
    ) as Array<{ id: string }>;
    const id = inserted[0]?.id;
    if (!id) throw new AppError('INTERNAL_ERROR', { status: 500 });
    await manager.query(
      `INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,commitment_id,operation_ref,actor_user_id)
       VALUES ($1,'RESERVE',0,$2::numeric,$3,$4,$5)`,
      [balances[0].id, quantity, id, `COMMITMENT_RESERVE:${id}`, actorId],
    );
    return id;
  }

  /**
   * Issues the still-reserved part of one line and counts it as delivered: the team takes the goods straight to the
   * people of the SOS. Locks cycle, need, then commitment. Returns false when nothing was left to issue.
   */
  private async issueLine(
    manager: EntityManager,
    request: SupplyRequestRow,
    line: { relief_need_id: string; commitment_id: string | null; unit_scale: number | string },
    actorId: string,
  ): Promise<boolean> {
    const cycles = await manager.query(
      'SELECT c.state FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id WHERE n.id=$1 FOR UPDATE OF c',
      [line.relief_need_id],
    ) as Array<{ state: string }>;
    if (cycles[0]?.state === 'FROZEN') throw new AppError('CYCLE_FROZEN', { status: 409 });
    if (cycles[0]?.state === 'SEALED') throw new AppError('CYCLE_SEALED', { status: 409 });
    const needs = await manager.query(
      'SELECT requested_quantity::text,status FROM relief_need WHERE id=$1 FOR UPDATE',
      [line.relief_need_id],
    ) as Array<{ requested_quantity: string; status: string }>;
    const need = needs[0];
    if (!need) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const commitments = await manager.query(
      `SELECT id,warehouse_id,item_id,quantity::text,released_quantity::text,issued_quantity::text
         FROM commitment WHERE id=$1 FOR UPDATE`,
      [line.commitment_id],
    ) as Array<{ id: string; warehouse_id: string; item_id: string; quantity: string; released_quantity: string; issued_quantity: string }>;
    const commitment = commitments[0];
    if (!commitment || commitment.warehouse_id !== request.warehouse_id) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const scale = Number(line.unit_scale);
    const remaining = quantityUnits(commitment.quantity, scale) - quantityUnits(commitment.released_quantity, scale) -
      quantityUnits(commitment.issued_quantity, scale);
    // A coordinator may have reduced or cancelled the need meanwhile, which released part of the reservation.
    if (remaining <= 0n || need.status === 'CANCELLED') return false;
    const quantity = decimalFromUnits(remaining, scale);
    const balances = await manager.query(
      'SELECT id FROM stock_balance WHERE warehouse_id=$1 AND item_id=$2',
      [commitment.warehouse_id, commitment.item_id],
    ) as Array<{ id: string }>;
    if (!balances[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
    await manager.query(
      `INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,commitment_id,operation_ref,actor_user_id)
       VALUES ($1,'ISSUE',-$2::numeric,-$2::numeric,$3,$4,$5)`,
      [balances[0].id, quantity, commitment.id, `SUPPLY_ISSUE:${request.id}:${commitment.id}`, actorId],
    );
    await manager.query(
      `UPDATE commitment SET issued_quantity=issued_quantity+$2::numeric,delivered_quantity=delivered_quantity+$2::numeric,
              version=version+1 WHERE id=$1`,
      [commitment.id, quantity],
    );
    const delivered = await manager.query(
      'SELECT COALESCE(SUM(delivered_quantity),0)::text AS delivered FROM commitment WHERE relief_need_id=$1',
      [line.relief_need_id],
    ) as Array<{ delivered: string }>;
    const status = needStatus(quantityUnits(delivered[0]?.delivered ?? '0', scale), quantityUnits(need.requested_quantity, scale));
    if (status !== need.status) {
      await manager.query('UPDATE relief_need SET status=$2,version=version+1 WHERE id=$1', [line.relief_need_id, status]);
    }
    return true;
  }
}

function assertVersion(row: SupplyRequestRow, expected: number): void {
  if (Number(row.version) !== expected) {
    throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(row.version) } });
  }
}
