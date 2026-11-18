import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { hasPermission } from '@c48/identity-contracts/permissions';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { hasWarehouseScope } from '../stock/stock.scope';
import { PickupTicketListQueryDto } from './pickup-tickets.dto';
import { PickupLineRow, PickupReadFlags, PickupTicketRow, requirePickupPermission, ticketView } from './pickup-tickets.helpers';
import { isHandoverOverdue } from './pickup-closeout.rules';
import { unaccountedGoods } from './unaccounted-goods.service';

const ticketColumns = `id,mission_id,request_id,campaign_id,team_id,warehouse_id,status,distribution_id,ready_at,reserved_by,
  confirmed_by,confirmed_at,handed_over_by,handed_over_at,collected_by_user_id,cancelled_at,cancel_reason,closed_by,closed_at,
  version,created_at,updated_at`;

const lineSql = `SELECT l.ticket_id,l.relief_need_id,l.commitment_id,l.item_id,i.name AS item_name,i.unit_code,u.scale AS unit_scale,
  l.requested_quantity::text,l.reserved_quantity::text
  FROM pickup_ticket_line l JOIN item i ON i.id=l.item_id JOIN unit u ON u.code=i.unit_code`;

/** Read model for pickup tickets. Read-only; permissions are checked before any row is returned. */
@Injectable()
export class PickupTicketsQueriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async detail(id: string, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const rows = await this.dataSource.query(`SELECT ${ticketColumns} FROM pickup_ticket WHERE id=$1`, [id]) as PickupTicketRow[];
    const row = rows[0];
    if (!row || !hasWarehouseScope(session.grants, { campaign_id: row.campaign_id })) throw new AppError('NOT_FOUND', { status: 404 });
    requirePickupPermission(session.grants, 'PICKUP_TICKET_VIEW', row.campaign_id);
    const lines = await this.dataSource.query(`${lineSql} WHERE l.ticket_id=$1 ORDER BY l.relief_need_id`, [id]) as PickupLineRow[];
    const flags = await this.readFlags(this.dataSource, [row]);
    return ticketView(row, lines, flags.get(row.id));
  }

  async list(query: PickupTicketListQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const grants = session.grants;
    const systemView = hasPermission(grants, 'PICKUP_TICKET_VIEW', { campaignId: null });
    const campaignIds = [...new Set(grants.flatMap((grant) => (
      grant.scope_type === 'CAMPAIGN' && grant.campaign_id && hasPermission(grants, 'PICKUP_TICKET_VIEW', { campaignId: grant.campaign_id })
        ? [grant.campaign_id]
        : []
    )))];
    if (!systemView && campaignIds.length === 0) throw new AppError('FORBIDDEN', { status: 403 });

    const filters = { mission_id: query.mission_id ?? null, status: query.status ?? null };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : undefined;
    const limit = query.limit ?? 50;
    const values: unknown[] = [];
    const where: string[] = [];
    if (!systemView) {
      values.push(campaignIds);
      where.push(`campaign_id = ANY($${values.length}::uuid[])`);
    }
    if (query.mission_id) {
      values.push(query.mission_id);
      where.push(`mission_id = $${values.length}`);
    }
    if (query.status) {
      values.push(query.status);
      where.push(`status = $${values.length}`);
    }
    if (cursor) {
      values.push(cursor.sort[0], cursor.id);
      where.push(`(created_at, id) < ($${values.length - 1}::timestamptz, $${values.length}::uuid)`);
    }
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT ${ticketColumns}, to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
         FROM pickup_ticket ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY created_at DESC, id DESC LIMIT $${values.length}`,
      values,
    ) as Array<PickupTicketRow & { cursor_created_at: string }>;
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const lines = page.length === 0 ? [] : await this.dataSource.query(
      `${lineSql} WHERE l.ticket_id = ANY($1::uuid[]) ORDER BY l.ticket_id, l.relief_need_id`,
      [page.map((row) => row.id)],
    ) as PickupLineRow[];
    const next = more ? page.at(-1) : undefined;
    const flags = await this.readFlags(this.dataSource, page);
    return {
      items: page.map((row) => ticketView(row, lines.filter((line) => line.ticket_id === row.id), flags.get(row.id))),
      more,
      ...(next ? { cursor: encodeKeysetCursor([next.cursor_created_at], next.id, filters) } : {}),
    };
  }

  /** Warnings are computed on every read and never stored: goods still held, and held longer than the overdue window. */
  private async readFlags(
    source: Pick<DataSource, 'query'>,
    rows: readonly PickupTicketRow[],
  ): Promise<Map<string, PickupReadFlags>> {
    const now = new Date();
    const unaccounted = new Set((await unaccountedGoods(source, { ticketIds: rows.map((row) => row.id) })).map((row) => row.ticket_id));
    return new Map(rows.map((row) => {
      const held = unaccounted.has(row.id) && row.status === 'HANDED_OVER';
      return [row.id, { unaccounted_goods: held, handover_overdue: isHandoverOverdue(row.handed_over_at, held, now) }];
    }));
  }
}
