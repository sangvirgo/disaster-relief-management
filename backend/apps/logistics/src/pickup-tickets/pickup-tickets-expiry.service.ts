import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { claimBatch } from '@c48/technical/persistence/jobs';
import { decimalFromUnits, quantityUnits } from '../common/quantity';
import { PICKUP_EXPIRY_HOURS, PickupLineRow, PickupTicketRow, ticketState, writePickupAudit } from './pickup-tickets.helpers';

interface ClaimedTicket {
  id: string;
  reserved_by: string | null;
}

/**
 * Expiry sweep for READY tickets that nobody confirmed within PICKUP_EXPIRY_HOURS. A system job has no user session, so
 * it cannot call the session-based release; instead it writes the same RELEASE movement that NeedCommitmentsService.release
 * writes (same operation_ref format, same lock order: cycle, then commitment). The movement is attributed to the user who
 * reserved the stock. Tickets whose cycle is SEALED are skipped and left for a coordinator.
 */
@Injectable()
export class PickupTicketExpiryService {
  async sweep(manager: EntityManager): Promise<number> {
    const claimed = await claimBatch<ClaimedTicket>(
      manager,
      `SELECT id, reserved_by FROM pickup_ticket
        WHERE status = 'READY' AND confirmed_at IS NULL AND ready_at < clock_timestamp() - interval '${PICKUP_EXPIRY_HOURS} hours'
        ORDER BY ready_at, id`,
    );
    let expired = 0;
    for (const ticket of claimed) {
      if (await this.expireOne(manager, ticket)) expired += 1;
    }
    return expired;
  }

  private async expireOne(manager: EntityManager, claimed: ClaimedTicket): Promise<boolean> {
    const rows = await manager.query(
      `SELECT id,warehouse_id,campaign_id,team_id,status,distribution_id,ready_at,reserved_by,confirmed_by,confirmed_at,
              handed_over_by,handed_over_at,collected_by_user_id,cancelled_at,cancel_reason,version,created_at,updated_at,mission_id,request_id
         FROM pickup_ticket WHERE id=$1 FOR UPDATE`,
      [claimed.id],
    ) as Array<PickupTicketRow>;
    const row = rows[0];
    if (!row || row.status !== 'READY' || row.confirmed_at !== null || !row.distribution_id || !claimed.reserved_by) return false;

    const distributions = await manager.query(
      'SELECT id,status,version FROM distribution WHERE id=$1 FOR UPDATE',
      [row.distribution_id],
    ) as Array<{ id: string; status: string; version: number | string }>;
    const distribution = distributions[0];
    if (!distribution) throw new AppError('INTERNAL_ERROR', { status: 500 });
    if (distribution.status === 'DISPATCHED' || distribution.status === 'RECONCILED') return false;

    const lines = await manager.query(
      `SELECT l.ticket_id,l.relief_need_id,l.commitment_id,l.item_id,i.name AS item_name,i.unit_code,u.scale AS unit_scale,
              l.requested_quantity::text,l.reserved_quantity::text
         FROM pickup_ticket_line l JOIN item i ON i.id=l.item_id JOIN unit u ON u.code=i.unit_code
        WHERE l.ticket_id=$1 ORDER BY l.relief_need_id`,
      [row.id],
    ) as PickupLineRow[];
    const reservedLines = lines.filter((line) => line.commitment_id !== null);

    // Pass 1: lock cycles in the required order and skip sealed cycles before any write.
    for (const line of reservedLines) {
      const cycles = await manager.query(
        'SELECT c.state FROM relief_need n JOIN fulfillment_cycle c ON c.id=n.cycle_id WHERE n.id=$1 FOR UPDATE OF c',
        [line.relief_need_id],
      ) as Array<{ state: string }>;
      if (cycles[0]?.state === 'SEALED') return false;
    }

    // Pass 2: release the unissued remainder of each reservation, then cancel the draft and the ticket.
    for (const line of reservedLines) {
      const scale = Number(line.unit_scale);
      const commitments = await manager.query(
        `SELECT id,warehouse_id,item_id,version,quantity::text,released_quantity::text,issued_quantity::text
           FROM commitment WHERE id=$1 FOR UPDATE`,
        [line.commitment_id],
      ) as Array<{ id: string; warehouse_id: string; item_id: string; version: number | string; quantity: string; released_quantity: string; issued_quantity: string }>;
      const commitment = commitments[0];
      if (!commitment) throw new AppError('INTERNAL_ERROR', { status: 500 });
      const remaining = quantityUnits(commitment.quantity, scale) - quantityUnits(commitment.released_quantity, scale) - quantityUnits(commitment.issued_quantity, scale);
      if (remaining <= 0n) continue;
      const quantity = decimalFromUnits(remaining, scale);
      const version = Number(commitment.version);
      await manager.query(
        'UPDATE commitment SET released_quantity=released_quantity+$2::numeric,version=version+1 WHERE id=$1 AND version=$3',
        [commitment.id, quantity, version],
      );
      const balances = await manager.query(
        'SELECT id FROM stock_balance WHERE warehouse_id=$1 AND item_id=$2',
        [commitment.warehouse_id, commitment.item_id],
      ) as Array<{ id: string }>;
      if (!balances[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
      await manager.query(
        `INSERT INTO stock_movement (balance_id,movement_type,delta_on_hand,delta_reserved,commitment_id,operation_ref,actor_user_id)
         VALUES ($1,'RELEASE',0,-$2::numeric,$3,$4,$5)`,
        [balances[0].id, quantity, commitment.id, `COMMITMENT_RELEASE:${commitment.id}:${version}`, claimed.reserved_by],
      );
    }

    const before = ticketState(row);
    if (distribution.status === 'DRAFT' || distribution.status === 'APPROVED') {
      await manager.query(
        "UPDATE distribution SET status='CANCELLED',version=version+1 WHERE id=$1 AND status IN ('DRAFT','APPROVED')",
        [distribution.id],
      );
    }
    const reason = `Tự động hủy sau ${PICKUP_EXPIRY_HOURS} giờ chưa xác nhận bàn giao`;
    await manager.query(
      `UPDATE pickup_ticket SET status='CANCELLED',cancelled_at=clock_timestamp(),cancel_reason=$2,
              version=version+1,updated_at=clock_timestamp()
        WHERE id=$1 AND status='READY'`,
      [row.id, reason],
    );
    await writePickupAudit(manager, null, 'PICKUP_TICKET_EXPIRED', row.id, before, { status: 'CANCELLED', version: Number(row.version) + 1, distribution_id: distribution.id }, reason);
    return true;
  }
}
