import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import type { Request } from 'express';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { requireIdempotencyKey } from '@c48/technical/http/response-headers';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { decimalFromUnits, quantityUnits, validateQuantity } from '../common/quantity';
import { HandoffCommandsService } from '../distributions/handoff-commands.service';
import type { CreateHandoffDto } from '../distributions/distributions.dto';
import { nextCustodyBalance } from '../distributions/distributions.helpers';
import { hasWarehouseScope, requireWarehousePermission } from '../stock/stock.scope';
import { DeliverPickupGoodsDto, CloseoutLineDto, ReviewCloseoutDto, SaveCloseoutDto } from './pickup-goods.dto';
import { PickupExpectedVersionDto } from './pickup-tickets.dto';
import {
  PickupLineRow, PickupReadFlags, PickupRequest, PickupTicketRow, requirePickupPermission, stepRequest, ticketState, ticketView,
  writePickupAudit,
} from './pickup-tickets.helpers';
import {
  allocate, assertIndependentCloseoutReviewer, BaselineItem, CloseoutAmounts, isHandoverOverdue, proposeAmounts,
  RETIRE_REASON_LABELS, RetireReason, validateAmounts,
} from './pickup-closeout.rules';
import { unaccountedGoods } from './unaccounted-goods.service';

const DEFAULT_RECEIVER_LABEL = 'Người nhận hàng tại hiện trường';
const DELIVERY_BASIS = 'Giao tại hiện trường theo phiếu lấy hàng';
const RETURN_RECEIVER_LABEL = 'Nhập lại kho từ phiếu đối soát';

type Permission = Parameters<typeof requirePickupPermission>[1];
type Grants = Parameters<typeof hasWarehouseScope>[0];

interface LineBaselineRow {
  distribution_line_id: string;
  item_id: string;
  item_name: string;
  unit_code: string;
  unit_scale: number | string;
  returnable: boolean;
  perishable: boolean;
  quantity: string;
  in_transit_quantity: string;
  at_point_quantity: string;
}

interface CloseoutRow {
  id: string;
  ticket_id: string;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
  submitted_by: string | null;
  submitted_at: Date | string | null;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  review_note: string | null;
  version: number | string;
}

interface StoredLineRow {
  item_id: string;
  held_quantity: string;
  delivered_quantity: string;
  returned_quantity: string;
  retired_quantity: string;
  retire_reason: RetireReason | null;
  note: string | null;
}

interface ValidatedLine {
  item: BaselineItem;
  amounts: CloseoutAmounts;
  note: string | null;
}

const ticketColumns = `id,mission_id,request_id,campaign_id,team_id,warehouse_id,status,distribution_id,ready_at,reserved_by,
  confirmed_by,confirmed_at,handed_over_by,handed_over_at,collected_by_user_id,cancelled_at,cancel_reason,closed_by,closed_at,
  version,created_at,updated_at`;

const lineSql = `SELECT l.ticket_id,l.relief_need_id,l.commitment_id,l.item_id,i.name AS item_name,i.unit_code,u.scale AS unit_scale,
  l.requested_quantity::text,l.reserved_quantity::text
  FROM pickup_ticket_line l JOIN item i ON i.id=l.item_id JOIN unit u ON u.code=i.unit_code`;

function assertVersion(row: PickupTicketRow, expected: number): void {
  if (Number(row.version) !== expected) throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(row.version) } });
}

function assertSameLines(stored: readonly StoredLineRow[], items: readonly BaselineItem[]): void {
  if (stored.length !== items.length) throw new AppError('CLOSEOUT_STALE', { status: 409 });
}

function storedAmounts(item: BaselineItem, stored: StoredLineRow): CloseoutAmounts {
  return {
    returned: quantityUnits(stored.returned_quantity, item.scale),
    retired: quantityUnits(stored.retired_quantity, item.scale),
    reason: stored.retire_reason,
  };
}

/** Pure check of a submitted line set: one line per ticket item, each balanced under the close-out invariant. */
function validateLineSet(items: readonly BaselineItem[], input: readonly CloseoutLineDto[]): ValidatedLine[] {
  const byItem = new Map<string, CloseoutLineDto>();
  for (const line of input) {
    if (byItem.has(line.item_id)) throw new AppError('CLOSEOUT_LINES_INVALID', { status: 400 });
    byItem.set(line.item_id, line);
  }
  if (byItem.size !== items.length || items.some((item) => !byItem.has(item.item_id))) {
    throw new AppError('CLOSEOUT_LINES_INVALID', { status: 400 });
  }
  return items.map((item) => {
    const line = byItem.get(item.item_id)!;
    const returned = quantityUnits(validateQuantity(line.returned_quantity, item.scale, { allowZero: true }), item.scale);
    const retired = quantityUnits(validateQuantity(line.retired_quantity, item.scale, { allowZero: true }), item.scale);
    const amounts = validateAmounts(item, { returned, retired, reason: line.retire_reason ?? null });
    return { item, amounts, note: line.note?.trim() || null };
  });
}

/**
 * Deliveries and close-out of a HANDED_OVER pickup ticket (proposal sections 3.6 and 3.7).
 *
 * Existing writers only: deliveries post a DIRECT_HOUSEHOLD handoff (in-transit counter and DELIVERED settlement); returns post a
 * RETURN handoff (RETURN stock movement and RETURNED settlement); retired goods reduce the in-transit counter with the LOSS
 * arithmetic but write no stock movement, because the dispatch ISSUE already removed them from on-hand. Team custody is
 * decremented here. Each inner step gets a derived idempotency key, so a retry of the same outer command replays it.
 *
 * Separation of duties: the close-out reviewer must differ from the submitter and from the user who handed the goods over.
 */
@Injectable()
export class PickupGoodsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: LogisticsSessionService,
    private readonly handoffs: HandoffCommandsService,
  ) {}

  /** Records goods delivered on scene. Reduces team custody and the distribution in-transit counter; cannot exceed custody. */
  async deliver(id: string, dto: DeliverPickupGoodsDto, request: PickupRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = requireIdempotencyKey(request);
    await this.assertTicketScope(this.dataSource, id, session.grants, 'PICKUP_TICKET_MANAGE');

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.pickup-tickets.deliveries',
      key,
      requestHash: canonicalRequestHash({ ticket_id: id, dto }),
      execute: async (manager) => {
        const locked = await this.lockTicket(manager, id, session.grants, 'PICKUP_TICKET_MANAGE');
        assertVersion(locked, dto.expected_version);
        if (locked.status !== 'HANDED_OVER' || !locked.distribution_id) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (await this.openCloseoutStatus(manager, id) === 'SUBMITTED') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });

        const { items } = await this.baseline(manager, locked.distribution_id);
        const requested = new Map<string, bigint>();
        const handoffLines: Array<{ distribution_line_id: string; quantity: string }> = [];
        const custody: Array<{ item: BaselineItem; quantity: bigint }> = [];
        for (const line of dto.lines) {
          if (requested.has(line.item_id)) throw new AppError('VALIDATION_FAILED', { status: 400 });
          const item = items.find((candidate) => candidate.item_id === line.item_id);
          if (!item) throw new AppError('PICKUP_ITEM_NOT_ON_TICKET', { status: 400 });
          const quantity = quantityUnits(validateQuantity(line.quantity, item.scale), item.scale);
          requested.set(line.item_id, quantity);
          const plan = allocate(item.lines.map((candidate) => ({ id: candidate.distribution_line_id, capacity: candidate.in_transit })), quantity);
          if (plan.allocated !== quantity) {
            throw new AppError('PICKUP_DELIVERY_EXCEEDS_CUSTODY', { status: 409, details: { item_id: item.item_id } });
          }
          for (const [distributionLineId, amount] of plan.allocations) {
            handoffLines.push({ distribution_line_id: distributionLineId, quantity: decimalFromUnits(amount, item.scale) });
          }
          custody.push({ item, quantity });
        }

        // Stock-side record first: the existing handoff writer checks the in-transit balance under the distribution lock.
        await this.handoffs.create(locked.distribution_id, {
          handoff_kind: 'DIRECT_HOUSEHOLD',
          receiver_label: dto.receiver_label?.trim() || DEFAULT_RECEIVER_LABEL,
          confirmation_basis: DELIVERY_BASIS,
          occurred_at: dto.occurred_at,
          lines: handoffLines,
        } as unknown as CreateHandoffDto, stepRequest(request, 'deliver'));

        for (const { item, quantity } of custody) {
          await this.decrementCustody(manager, locked, item, quantity);
        }
        const before = ticketState(locked);
        const updated = await manager.query(
          `UPDATE pickup_ticket SET version=version+1,updated_at=clock_timestamp()
            WHERE id=$1 AND version=$2 AND status='HANDED_OVER' RETURNING id`,
          [id, dto.expected_version],
        ) as Array<{ id: string }>;
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const row = await this.loadTicket(manager, id);
        await writePickupAudit(manager, session.userId, 'PICKUP_GOODS_DELIVERED', id, before, ticketState(row), null);
        return { status: 200, value: await this.ticketValue(manager, row), resource: { type: 'pickup_ticket', id } };
      },
      replay: (manager, resource) => this.replayTicket(manager, resource, session.grants, 'PICKUP_TICKET_MANAGE'),
    });
  }

  /** Close-out view: proposed lines when nothing is saved yet, otherwise the saved draft or the approved record. Read-only. */
  async closeout(id: string, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const row = await this.assertTicketScope(this.dataSource, id, session.grants, 'PICKUP_TICKET_VIEW');
    return this.closeoutView(this.dataSource, row);
  }

  /** Saves the draft close-out. Requires HANDED_OVER and an unsubmitted draft. Every item needs exactly one balanced line. */
  async saveCloseout(id: string, dto: SaveCloseoutDto, request: PickupRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = requireIdempotencyKey(request);
    await this.assertTicketScope(this.dataSource, id, session.grants, 'PICKUP_CLOSEOUT_SUBMIT');

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.pickup-tickets.closeout.save',
      key,
      requestHash: canonicalRequestHash({ ticket_id: id, dto }),
      execute: async (manager) => {
        const locked = await this.lockTicket(manager, id, session.grants, 'PICKUP_CLOSEOUT_SUBMIT');
        if (locked.status !== 'HANDED_OVER' || !locked.distribution_id) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const existing = await this.openCloseout(manager, id, true);
        if (existing?.status === 'SUBMITTED') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const currentVersion = existing ? Number(existing.version) : 0;
        if (dto.expected_version !== currentVersion) {
          throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: currentVersion } });
        }
        const { items, pendingLoss } = await this.baseline(manager, locked.distribution_id);
        if (pendingLoss || items.some((item) => !item.ledgerBalanced)) throw new AppError('PICKUP_LEDGER_MISMATCH', { status: 409 });
        const validated = validateLineSet(items, dto.lines);

        let closeoutId: string;
        if (existing) {
          const bumped = await manager.query(
            `UPDATE pickup_ticket_closeout SET version=version+1,updated_at=clock_timestamp()
              WHERE id=$1 AND version=$2 AND status='DRAFT' RETURNING id`,
            [existing.id, dto.expected_version],
          ) as Array<{ id: string }>;
          if (!bumped[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
          closeoutId = existing.id;
        } else {
          const inserted = await manager.query(
            `INSERT INTO pickup_ticket_closeout (ticket_id,status,version) VALUES ($1,'DRAFT',1) RETURNING id`,
            [id],
          ) as Array<{ id: string }>;
          if (!inserted[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
          closeoutId = inserted[0].id;
        }
        await this.replaceLines(manager, closeoutId, validated);
        await writePickupAudit(manager, session.userId, 'PICKUP_CLOSEOUT_SAVED', id, null, { closeout_id: closeoutId, status: 'DRAFT' });
        return { status: 200, value: await this.closeoutView(manager, locked), resource: { type: 'pickup_closeout', id: closeoutId } };
      },
      replay: (manager, resource) => this.replayCloseout(manager, resource, session.grants, 'PICKUP_CLOSEOUT_SUBMIT'),
    });
  }

  /** Locks the draft: DRAFT -> SUBMITTED. The lines are re-validated against live figures first. */
  async submitCloseout(id: string, dto: PickupExpectedVersionDto, request: PickupRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = requireIdempotencyKey(request);
    await this.assertTicketScope(this.dataSource, id, session.grants, 'PICKUP_CLOSEOUT_SUBMIT');

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.pickup-tickets.closeout.submit',
      key,
      requestHash: canonicalRequestHash({ ticket_id: id, dto }),
      execute: async (manager) => {
        const locked = await this.lockTicket(manager, id, session.grants, 'PICKUP_CLOSEOUT_SUBMIT');
        if (locked.status !== 'HANDED_OVER' || !locked.distribution_id) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const closeout = await this.openCloseout(manager, id, true);
        if (!closeout || closeout.status !== 'DRAFT') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (Number(closeout.version) !== dto.expected_version) {
          throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(closeout.version) } });
        }
        const { items, pendingLoss } = await this.baseline(manager, locked.distribution_id);
        if (pendingLoss || items.some((item) => !item.ledgerBalanced)) throw new AppError('PICKUP_LEDGER_MISMATCH', { status: 409 });
        const stored = await this.storedLines(manager, closeout.id);
        assertSameLines(stored, items);
        const validated = items.map((item) => {
          const line = stored.find((candidate) => candidate.item_id === item.item_id);
          if (!line) throw new AppError('CLOSEOUT_LINES_INVALID', { status: 400 });
          return { item, amounts: validateAmounts(item, storedAmounts(item, line)), note: line.note };
        });
        await this.replaceLines(manager, closeout.id, validated);
        const bumped = await manager.query(
          `UPDATE pickup_ticket_closeout SET status='SUBMITTED',submitted_by=$2,submitted_at=clock_timestamp(),
                  version=version+1,updated_at=clock_timestamp()
            WHERE id=$1 AND version=$3 AND status='DRAFT' RETURNING id`,
          [closeout.id, session.userId, dto.expected_version],
        ) as Array<{ id: string }>;
        if (!bumped[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        await writePickupAudit(manager, session.userId, 'PICKUP_CLOSEOUT_SUBMITTED', id, { closeout_status: 'DRAFT' }, { closeout_status: 'SUBMITTED' });
        return { status: 200, value: await this.closeoutView(manager, locked), resource: { type: 'pickup_closeout', id: closeout.id } };
      },
      replay: (manager, resource) => this.replayCloseout(manager, resource, session.grants, 'PICKUP_CLOSEOUT_SUBMIT'),
    });
  }

  /**
   * Approves or rejects a SUBMITTED close-out. Approval posts the returns (RETURN handoff, so RETURN stock movements), retires
   * the rest (in-transit counter), clears this ticket's custody and sets the ticket CLOSED, in one command. Rejection returns
   * the close-out to DRAFT with the note.
   */
  async reviewCloseout(id: string, dto: ReviewCloseoutDto, request: PickupRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const key = requireIdempotencyKey(request);
    await this.assertTicketScope(this.dataSource, id, session.grants, 'PICKUP_CLOSEOUT_REVIEW');
    const note = dto.note?.trim() || null;
    if (dto.decision === 'REJECT' && note === null) {
      throw new AppError('VALIDATION_FAILED', { status: 400, fieldErrors: { note: ['Cần ghi lý do khi từ chối phiếu đối soát.'] } });
    }

    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'logistics.pickup-tickets.closeout.review',
      key,
      requestHash: canonicalRequestHash({ ticket_id: id, dto }),
      execute: async (manager) => {
        const locked = await this.lockTicket(manager, id, session.grants, 'PICKUP_CLOSEOUT_REVIEW');
        if (locked.status !== 'HANDED_OVER' || !locked.distribution_id) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const closeout = await this.openCloseout(manager, id, true);
        if (!closeout || closeout.status !== 'SUBMITTED') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (Number(closeout.version) !== dto.expected_version) {
          throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(closeout.version) } });
        }
        assertIndependentCloseoutReviewer(closeout.submitted_by, locked.handed_over_by, session.userId);

        if (dto.decision === 'REJECT') {
          const rejected = await manager.query(
            `UPDATE pickup_ticket_closeout SET status='DRAFT',reviewed_by=$2,reviewed_at=clock_timestamp(),review_note=$3,
                    version=version+1,updated_at=clock_timestamp()
              WHERE id=$1 AND version=$4 AND status='SUBMITTED' RETURNING id`,
            [closeout.id, session.userId, note, dto.expected_version],
          ) as Array<{ id: string }>;
          if (!rejected[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
          await writePickupAudit(manager, session.userId, 'PICKUP_CLOSEOUT_REJECTED', id,
            { closeout_status: 'SUBMITTED' }, { closeout_status: 'DRAFT' }, note);
          return { status: 200, value: await this.closeoutView(manager, locked), resource: { type: 'pickup_closeout', id: closeout.id } };
        }

        const { items, pendingLoss } = await this.baseline(manager, locked.distribution_id);
        if (pendingLoss || items.some((item) => !item.ledgerBalanced)) throw new AppError('PICKUP_LEDGER_MISMATCH', { status: 409 });
        const stored = await this.storedLines(manager, closeout.id);
        assertSameLines(stored, items);
        const plans = items.map((item) => this.planItem(item, stored));
        const returnLines = plans.flatMap((plan) => [...plan.returns].filter(([, amount]) => amount > 0n)
          .map(([lineId, amount]) => ({ distribution_line_id: lineId, quantity: decimalFromUnits(amount, plan.item.scale) })));
        const submittedAt = new Date(closeout.submitted_at!).toISOString();

        // Returns go through the existing RETURN writer (RETURN stock movement). The recorder is the reviewer.
        if (returnLines.length > 0) {
          await this.handoffs.create(locked.distribution_id, {
            handoff_kind: 'RETURN',
            source_stage: 'IN_TRANSIT',
            receiver_label: RETURN_RECEIVER_LABEL,
            confirmation_basis: `Đối soát phiếu lấy hàng ${id}`,
            occurred_at: submittedAt,
            lines: returnLines,
          } as unknown as CreateHandoffDto, stepRequest(request, 'return'));
        }

        await this.retireInTransit(manager, locked.distribution_id, plans);
        for (const plan of plans) {
          const leaving = plan.returnedTotal + plan.retiredTotal;
          if (leaving > 0n) await this.decrementCustody(manager, locked, plan.item, leaving);
        }

        const approved = await manager.query(
          `UPDATE pickup_ticket_closeout SET status='APPROVED',reviewed_by=$2,reviewed_at=clock_timestamp(),review_note=$3,
                  version=version+1,updated_at=clock_timestamp()
            WHERE id=$1 AND version=$4 AND status='SUBMITTED' RETURNING id`,
          [closeout.id, session.userId, note, dto.expected_version],
        ) as Array<{ id: string }>;
        if (!approved[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        const closed = await manager.query(
          `UPDATE pickup_ticket SET status='CLOSED',closed_by=$2,closed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
            WHERE id=$1 AND status='HANDED_OVER' RETURNING id`,
          [id, session.userId],
        ) as Array<{ id: string }>;
        if (!closed[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        await writePickupAudit(manager, session.userId, 'PICKUP_CLOSEOUT_APPROVED', id,
          { closeout_status: 'SUBMITTED' }, { closeout_status: 'APPROVED' }, note);
        const row = await this.loadTicket(manager, id);
        await writePickupAudit(manager, session.userId, 'PICKUP_TICKET_CLOSED', id, ticketState(locked), ticketState(row));
        return { status: 200, value: await this.closeoutView(manager, row), resource: { type: 'pickup_closeout', id: closeout.id } };
      },
      replay: (manager, resource) => this.replayCloseout(manager, resource, session.grants, 'PICKUP_CLOSEOUT_REVIEW'),
    });
  }

  /** Per-item plan at approval: which distribution lines are returned and which are retired (allocation in line order). */
  private planItem(item: BaselineItem, stored: readonly StoredLineRow[]): {
    item: BaselineItem; returns: Map<string, bigint>; retires: Map<string, bigint>; returnedTotal: bigint; retiredTotal: bigint;
  } {
    const line = stored.find((candidate) => candidate.item_id === item.item_id);
    if (!line) throw new AppError('CLOSEOUT_STALE', { status: 409 });
    if (quantityUnits(line.held_quantity, item.scale) !== item.held || quantityUnits(line.delivered_quantity, item.scale) !== item.delivered) {
      throw new AppError('CLOSEOUT_STALE', { status: 409 });
    }
    let amounts: CloseoutAmounts;
    try {
      amounts = validateAmounts(item, storedAmounts(item, line));
    } catch (error) {
      if (error instanceof AppError && error.code === 'CLOSEOUT_INVARIANT_VIOLATED') throw new AppError('CLOSEOUT_STALE', { status: 409 });
      throw error;
    }
    const capacities = item.lines.map((candidate) => ({ id: candidate.distribution_line_id, capacity: candidate.in_transit }));
    const returned = allocate(capacities, amounts.returned);
    const afterReturn = capacities.map((candidate) => ({ id: candidate.id, capacity: candidate.capacity - (returned.allocations.get(candidate.id) ?? 0n) }));
    const retired = allocate(afterReturn, amounts.retired);
    if (returned.allocated !== amounts.returned || retired.allocated !== amounts.retired) {
      throw new AppError('PICKUP_LEDGER_MISMATCH', { status: 409 });
    }
    return { item, returns: returned.allocations, retires: retired.allocations, returnedTotal: amounts.returned, retiredTotal: amounts.retired };
  }

  /** Retired goods leave the in-transit counter (LOSS arithmetic) and write no stock movement; the dispatch ISSUE already removed them. */
  private async retireInTransit(
    manager: EntityManager,
    distributionId: string,
    plans: ReadonlyArray<{ retires: Map<string, bigint> }>,
  ): Promise<void> {
    const retiring = plans.flatMap((plan) => [...plan.retires].filter(([, amount]) => amount > 0n));
    if (retiring.length === 0) return;
    const distribution = await manager.query(
      'SELECT id,relief_point_id FROM distribution WHERE id=$1 FOR UPDATE',
      [distributionId],
    ) as Array<{ id: string; relief_point_id: string | null }>;
    if (!distribution[0]) throw new AppError('NOT_FOUND', { status: 404 });
    const counters = await manager.query(
      `SELECT dl.id,dl.in_transit_quantity::text,dl.at_point_quantity::text,u.scale AS unit_scale
         FROM distribution_line dl JOIN item i ON i.id=dl.item_id JOIN unit u ON u.code=i.unit_code
        WHERE dl.distribution_id=$1`,
      [distributionId],
    ) as Array<{ id: string; in_transit_quantity: string; at_point_quantity: string; unit_scale: number | string }>;
    for (const [lineId, amount] of retiring) {
      const current = counters.find((row) => row.id === lineId);
      if (!current) throw new AppError('PICKUP_LEDGER_MISMATCH', { status: 409 });
      const scale = Number(current.unit_scale);
      const next = nextCustodyBalance({
        handoffKind: 'LOSS',
        sourceStage: 'IN_TRANSIT',
        quantity: amount,
        inTransit: quantityUnits(current.in_transit_quantity, scale),
        atPoint: quantityUnits(current.at_point_quantity, scale),
        hasReliefPoint: distribution[0].relief_point_id !== null,
      });
      await manager.query(
        'UPDATE distribution_line SET in_transit_quantity=$2::numeric,at_point_quantity=$3::numeric WHERE id=$1',
        [lineId, decimalFromUnits(next.inTransit, scale), decimalFromUnits(next.atPoint, scale)],
      );
    }
  }

  /** Team custody falls by what leaves the team on this ticket. The CHECK-like guard refuses to go below zero. */
  private async decrementCustody(manager: EntityManager, ticket: PickupTicketRow, item: BaselineItem, quantity: bigint): Promise<void> {
    if (!ticket.team_id) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const rows = await manager.query(
      `UPDATE team_custody SET quantity_held=quantity_held-$3::numeric,updated_at=clock_timestamp()
        WHERE team_id=$1 AND item_id=$2 AND quantity_held >= $3::numeric RETURNING item_id`,
      [ticket.team_id, item.item_id, decimalFromUnits(quantity, item.scale)],
    ) as Array<{ item_id: string }>;
    if (!rows[0]) throw new AppError('PICKUP_LEDGER_MISMATCH', { status: 409 });
  }

  /**
   * Per-item figures from the distribution: held = issued to the ticket, delivered = DIRECT_HOUSEHOLD handoffs, remaining = goods
   * still on the team side. ledgerBalanced checks held - delivered = remaining (no handoffs outside the pickup flow).
   */
  private async baseline(manager: Pick<EntityManager, 'query'>, distributionId: string): Promise<{ items: BaselineItem[]; pendingLoss: boolean }> {
    const rows = await manager.query(
      `SELECT dl.id AS distribution_line_id,dl.item_id,i.name AS item_name,i.unit_code,u.scale AS unit_scale,i.returnable,i.perishable,
              dl.quantity::text,dl.in_transit_quantity::text,dl.at_point_quantity::text
         FROM distribution_line dl JOIN item i ON i.id=dl.item_id JOIN unit u ON u.code=i.unit_code
        WHERE dl.distribution_id=$1 ORDER BY dl.item_id,dl.id`,
      [distributionId],
    ) as LineBaselineRow[];
    const deliveredRows = await manager.query(
      `SELECT dl.item_id,SUM(hl.quantity)::text AS delivered
         FROM handoff_record h JOIN handoff_line hl ON hl.handoff_id=h.id
         JOIN distribution_line dl ON dl.id=hl.distribution_line_id
        WHERE h.distribution_id=$1 AND h.handoff_kind='DIRECT_HOUSEHOLD' GROUP BY dl.item_id`,
      [distributionId],
    ) as Array<{ item_id: string; delivered: string }>;
    const pending = await manager.query(
      `SELECT 1 FROM handoff_record h LEFT JOIN handoff_loss_review r ON r.handoff_id=h.id
        WHERE h.distribution_id=$1 AND h.handoff_kind='LOSS' AND r.handoff_id IS NULL LIMIT 1`,
      [distributionId],
    ) as unknown[];

    const byItem = new Map<string, BaselineItem>();
    for (const row of rows) {
      const scale = Number(row.unit_scale);
      let item = byItem.get(row.item_id);
      if (!item) {
        item = {
          item_id: row.item_id, item_name: row.item_name, unit_code: row.unit_code, scale, returnable: row.returnable, perishable: row.perishable,
          held: 0n, delivered: 0n, remaining: 0n, ledgerBalanced: true, lines: [],
        };
        byItem.set(row.item_id, item);
      }
      const inTransit = quantityUnits(row.in_transit_quantity, scale);
      const atPoint = quantityUnits(row.at_point_quantity, scale);
      item.held += quantityUnits(row.quantity, scale);
      item.remaining += inTransit + atPoint;
      item.lines.push({ distribution_line_id: row.distribution_line_id, in_transit: inTransit });
    }
    for (const row of deliveredRows) {
      const item = byItem.get(row.item_id);
      if (item) item.delivered = quantityUnits(row.delivered, item.scale);
    }
    for (const item of byItem.values()) {
      item.ledgerBalanced = item.held - item.delivered === item.remaining;
    }
    return { items: [...byItem.values()], pendingLoss: pending.length > 0 };
  }

  private async closeoutView(
    manager: Pick<EntityManager | DataSource, 'query'>,
    ticket: PickupTicketRow,
  ): Promise<Record<string, unknown>> {
    const closeout = await this.latestCloseout(manager, ticket.id);
    const status = closeout?.status ?? null;
    const stored = closeout ? await this.storedLines(manager, closeout.id) : [];
    const base = ticket.distribution_id && (ticket.status === 'HANDED_OVER' || ticket.status === 'CLOSED')
      ? await this.baseline(manager, ticket.distribution_id)
      : { items: [] as BaselineItem[], pendingLoss: false };

    const lines = base.items.map((item) => {
      const line = stored.find((candidate) => candidate.item_id === item.item_id);
      const amounts = line ? storedAmounts(item, line) : proposeAmounts(item);
      const remainingAmount = item.held - item.delivered;
      const balanced = ticket.status === 'CLOSED'
        ? amounts.returned + amounts.retired === remainingAmount
        : item.ledgerBalanced && amounts.returned + amounts.retired === remainingAmount;
      return {
        item_id: item.item_id,
        item_name: item.item_name,
        unit_code: item.unit_code,
        returnable: item.returnable,
        perishable: item.perishable,
        held_quantity: decimalFromUnits(item.held, item.scale),
        delivered_quantity: decimalFromUnits(item.delivered, item.scale),
        remaining_quantity: decimalFromUnits(remainingAmount, item.scale),
        returned_quantity: decimalFromUnits(amounts.returned, item.scale),
        retired_quantity: decimalFromUnits(amounts.retired, item.scale),
        retire_reason: amounts.reason,
        retire_reason_label: amounts.reason ? RETIRE_REASON_LABELS[amounts.reason] : null,
        note: line?.note ?? null,
        balanced,
      };
    });
    const editable = ticket.status === 'HANDED_OVER' && (status === null || status === 'DRAFT') && !base.pendingLoss;
    return {
      ticket_id: ticket.id,
      ticket_status: ticket.status,
      closeout_id: closeout?.id ?? null,
      closeout_status: status,
      version: closeout ? Number(closeout.version) : 0,
      editable,
      can_submit: editable && status === 'DRAFT' && lines.length > 0 && lines.every((line) => line.balanced),
      review_note: closeout?.review_note ?? null,
      submitted_at: closeout?.submitted_at ? new Date(closeout.submitted_at).toISOString() : null,
      reviewed_at: closeout?.reviewed_at ? new Date(closeout.reviewed_at).toISOString() : null,
      lines,
    };
  }

  private async ticketValue(manager: Pick<EntityManager | DataSource, 'query'>, row: PickupTicketRow): Promise<Record<string, unknown>> {
    const lines = await manager.query(`${lineSql} WHERE l.ticket_id=$1 ORDER BY l.relief_need_id`, [row.id]) as PickupLineRow[];
    const unaccounted = (await unaccountedGoods(manager, { ticketIds: [row.id] })).length > 0;
    const flags: PickupReadFlags = {
      unaccounted_goods: unaccounted,
      handover_overdue: isHandoverOverdue(row.handed_over_at, unaccounted && row.status === 'HANDED_OVER', new Date()),
    };
    return ticketView(row, lines, flags);
  }

  private async replayTicket(
    manager: EntityManager,
    resource: { type: string; id: string } | null,
    grants: Grants,
    permission: Permission,
  ): Promise<Record<string, unknown>> {
    if (resource?.type !== 'pickup_ticket') throw new AppError('INTERNAL_ERROR', { status: 500 });
    const row = await this.loadTicket(manager, resource.id);
    if (!hasWarehouseScope(grants, { campaign_id: row.campaign_id })) throw new AppError('NOT_FOUND', { status: 404 });
    requirePickupPermission(grants, permission, row.campaign_id);
    return this.ticketValue(manager, row);
  }

  private async replayCloseout(
    manager: EntityManager,
    resource: { type: string; id: string } | null,
    grants: Grants,
    permission: Permission,
  ): Promise<Record<string, unknown>> {
    if (resource?.type !== 'pickup_closeout') throw new AppError('INTERNAL_ERROR', { status: 500 });
    const rows = await manager.query('SELECT ticket_id FROM pickup_ticket_closeout WHERE id=$1', [resource.id]) as Array<{ ticket_id: string }>;
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    const row = await this.loadTicket(manager, rows[0].ticket_id);
    if (!hasWarehouseScope(grants, { campaign_id: row.campaign_id })) throw new AppError('NOT_FOUND', { status: 404 });
    requirePickupPermission(grants, permission, row.campaign_id);
    return this.closeoutView(manager, row);
  }

  private async openCloseoutStatus(manager: Pick<EntityManager, 'query'>, ticketId: string): Promise<string | null> {
    return (await this.openCloseout(manager, ticketId, false))?.status ?? null;
  }

  private async openCloseout(manager: Pick<EntityManager, 'query'>, ticketId: string, forUpdate: boolean): Promise<CloseoutRow | null> {
    const rows = await manager.query(
      `SELECT id,ticket_id,status,submitted_by,submitted_at,reviewed_by,reviewed_at,review_note,version
         FROM pickup_ticket_closeout WHERE ticket_id=$1 AND status IN ('DRAFT','SUBMITTED')${forUpdate ? ' FOR UPDATE' : ''}`,
      [ticketId],
    ) as CloseoutRow[];
    return rows[0] ?? null;
  }

  /** Open close-out if there is one, otherwise the approved record (a closed ticket keeps its close-out). */
  private async latestCloseout(manager: Pick<EntityManager | DataSource, 'query'>, ticketId: string): Promise<CloseoutRow | null> {
    const rows = await manager.query(
      `SELECT id,ticket_id,status,submitted_by,submitted_at,reviewed_by,reviewed_at,review_note,version
         FROM pickup_ticket_closeout WHERE ticket_id=$1
        ORDER BY (status IN ('DRAFT','SUBMITTED')) DESC, created_at DESC LIMIT 1`,
      [ticketId],
    ) as CloseoutRow[];
    return rows[0] ?? null;
  }

  private async storedLines(manager: Pick<EntityManager, 'query'>, closeoutId: string): Promise<StoredLineRow[]> {
    return manager.query(
      `SELECT item_id,held_quantity::text,delivered_quantity::text,returned_quantity::text,retired_quantity::text,retire_reason,note
         FROM pickup_closeout_line WHERE closeout_id=$1 ORDER BY item_id`,
      [closeoutId],
    ) as Promise<StoredLineRow[]>;
  }

  private async replaceLines(manager: Pick<EntityManager, 'query'>, closeoutId: string, lines: readonly ValidatedLine[]): Promise<void> {
    for (const { item, amounts, note } of lines) {
      await manager.query(
        `INSERT INTO pickup_closeout_line (closeout_id,item_id,held_quantity,delivered_quantity,returned_quantity,retired_quantity,retire_reason,note)
         VALUES ($1,$2,$3::numeric,$4::numeric,$5::numeric,$6::numeric,$7,$8)
         ON CONFLICT (closeout_id,item_id) DO UPDATE SET held_quantity=EXCLUDED.held_quantity,delivered_quantity=EXCLUDED.delivered_quantity,
           returned_quantity=EXCLUDED.returned_quantity,retired_quantity=EXCLUDED.retired_quantity,
           retire_reason=EXCLUDED.retire_reason,note=EXCLUDED.note`,
        [
          closeoutId, item.item_id,
          decimalFromUnits(item.held, item.scale), decimalFromUnits(item.delivered, item.scale),
          decimalFromUnits(amounts.returned, item.scale), decimalFromUnits(amounts.retired, item.scale),
          amounts.reason, note,
        ],
      );
    }
  }

  private async loadTicket(manager: Pick<EntityManager | DataSource, 'query'>, id: string, forUpdate = false): Promise<PickupTicketRow> {
    const rows = await manager.query(
      `SELECT ${ticketColumns} FROM pickup_ticket WHERE id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
      [id],
    ) as PickupTicketRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private async lockTicket(manager: EntityManager, id: string, grants: Grants, permission: Permission): Promise<PickupTicketRow> {
    const row = await this.loadTicket(manager, id, true);
    if (!hasWarehouseScope(grants, { campaign_id: row.campaign_id })) throw new AppError('NOT_FOUND', { status: 404 });
    requirePickupPermission(grants, permission, row.campaign_id);
    return row;
  }

  private async assertTicketScope(
    source: Pick<DataSource | EntityManager, 'query'>,
    id: string,
    grants: Grants,
    permission: Permission,
  ): Promise<PickupTicketRow> {
    const row = await this.loadTicket(source, id);
    if (!hasWarehouseScope(grants, { campaign_id: row.campaign_id })) throw new AppError('NOT_FOUND', { status: 404 });
    requireWarehousePermission(grants, permission, { campaign_id: row.campaign_id });
    return row;
  }
}
