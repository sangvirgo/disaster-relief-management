import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { StockAdjustmentListQueryDto, StockListQueryDto, StockPageQueryDto } from './stock.dto';
import { hasWarehouseScope, stockWarehouseScopeSql } from './stock.scope';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface WarehouseRow {
  organization_id: string;
  region_code: string;
}

function filterHash(route: string, userId: string, grants: unknown[], filters: Record<string, unknown>): Record<string, unknown> {
  return { route, user_id: userId, grants, ...filters };
}

function validIdCursor(cursor: ReturnType<typeof decodeKeysetCursor>): boolean {
  return cursor.sort.length === 1 && typeof cursor.sort[0] === 'string' && cursor.sort[0] === cursor.id && uuidPattern.test(cursor.id);
}

function validMovementCursor(cursor: ReturnType<typeof decodeKeysetCursor>): boolean {
  if (cursor.sort.length !== 1 || typeof cursor.sort[0] !== 'string' || !uuidPattern.test(cursor.id)) return false;
  const date = new Date(cursor.sort[0]);
  return Number.isFinite(date.getTime()) && date.toISOString() === cursor.sort[0];
}

@Injectable()
export class StockQueriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async balances(query: StockListQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const filters = filterHash('logistics.stock', session.userId, session.grants, {
      warehouse_id: query.warehouse_id ?? null,
      item_id: query.item_id ?? null,
    });
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : undefined;
    if (cursor && !validIdCursor(cursor)) throw new AppError('CURSOR_INVALID', { status: 400 });

    const values: unknown[] = [];
    const conditions = [stockWarehouseScopeSql(session.grants, values)];
    if (query.warehouse_id) {
      values.push(query.warehouse_id);
      conditions.push(`b.warehouse_id=$${values.length}`);
    }
    if (query.item_id) {
      values.push(query.item_id);
      conditions.push(`b.item_id=$${values.length}`);
    }
    if (cursor) {
      values.push(cursor.id, cursor.id);
      conditions.push(`(b.id,b.id)>($${values.length - 1}::uuid,$${values.length}::uuid)`);
    }
    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT b.id AS balance_id,b.warehouse_id,b.item_id,w.organization_id,w.region_code,
              i.name AS item_name,it.display_name AS item_type,un.code AS unit_code,un.display_name AS unit,
              un.scale,b.on_hand::text AS on_hand,b.reserved::text AS reserved,(b.on_hand-b.reserved)::text AS available
         FROM stock_balance b JOIN warehouse w ON w.id=b.warehouse_id
         JOIN item i ON i.id=b.item_id JOIN item_type it ON it.code=i.item_type_code JOIN unit un ON un.code=i.unit_code
        WHERE ${conditions.join(' AND ')} ORDER BY b.id ASC LIMIT $${values.length}`,
      values,
    ) as Array<Record<string, unknown> & { balance_id: string }>;
    const items = rows.slice(0, limit).map(({ organization_id: _organizationId, region_code: _regionCode, ...row }) => row);
    const last = rows[limit - 1];
    return {
      items,
      more: rows.length > limit,
      ...(rows.length > limit && last ? { cursor: encodeKeysetCursor([last.balance_id], last.balance_id, filters) } : {}),
    };
  }

  async movements(balanceId: string, query: StockPageQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const balanceRows = await this.dataSource.query(
      `SELECT b.id,w.organization_id,w.region_code FROM stock_balance b JOIN warehouse w ON w.id=b.warehouse_id WHERE b.id=$1`,
      [balanceId],
    ) as Array<{ id: string } & WarehouseRow>;
    const balance = balanceRows[0];
    if (!balance || !hasWarehouseScope(session.grants, balance.organization_id, balance.region_code)) {
      throw new AppError('NOT_FOUND', { status: 404 });
    }
    const filters = filterHash('logistics.stock.movements', session.userId, session.grants, { balance_id: balanceId });
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : undefined;
    if (cursor && !validMovementCursor(cursor)) throw new AppError('CURSOR_INVALID', { status: 400 });
    const values: unknown[] = [balanceId];
    const cursorCondition = cursor
      ? (values.push(cursor.sort[0], cursor.id), `AND (created_at,id)>($2::timestamptz,$3::uuid)`)
      : '';
    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT id,movement_type,delta_on_hand::text AS delta_on_hand,delta_reserved::text AS delta_reserved,created_at
         FROM stock_movement WHERE balance_id=$1 ${cursorCondition}
        ORDER BY created_at ASC,id ASC LIMIT $${values.length}`,
      values,
    ) as Array<{ id: string; movement_type: string; delta_on_hand: string; delta_reserved: string; created_at: Date | string }>;
    const items = rows.slice(0, limit).map((row) => ({
      id: row.id,
      movement_type: row.movement_type,
      delta_on_hand: row.delta_on_hand,
      delta_reserved: row.delta_reserved,
      created_at: new Date(row.created_at).toISOString(),
    }));
    const last = rows[limit - 1];
    return {
      balance_id: balanceId,
      items,
      more: rows.length > limit,
      ...(rows.length > limit && last ? { cursor: encodeKeysetCursor([new Date(last.created_at).toISOString()], last.id, filters) } : {}),
    };
  }

  async adjustments(query: StockAdjustmentListQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const filters = filterHash('logistics.stock.adjustments', session.userId, session.grants, { status: query.status ?? null });
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : undefined;
    if (cursor && !validMovementCursor(cursor)) throw new AppError('CURSOR_INVALID', { status: 400 });
    const values: unknown[] = [];
    const conditions = [stockWarehouseScopeSql(session.grants, values)];
    if (query.status) {
      values.push(query.status);
      conditions.push(`a.status=$${values.length}`);
    }
    if (cursor) {
      values.push(cursor.sort[0], cursor.id);
      conditions.push(`(a.requested_at,a.id)>($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
    }
    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT a.id,a.balance_id,b.warehouse_id,b.item_id,i.name AS item_name,un.code AS unit_code,
              a.delta_on_hand::text AS delta_on_hand,a.status,a.requested_at,a.reviewed_at
         FROM stock_adjustment a JOIN stock_balance b ON b.id=a.balance_id
         JOIN warehouse w ON w.id=b.warehouse_id JOIN item i ON i.id=b.item_id JOIN unit un ON un.code=i.unit_code
        WHERE ${conditions.join(' AND ')} ORDER BY a.requested_at ASC,a.id ASC LIMIT $${values.length}`,
      values,
    ) as Array<Record<string, unknown> & { id: string; requested_at: Date | string }>;
    const items = rows.slice(0, limit).map((row) => ({
      ...row,
      requested_at: new Date(row.requested_at).toISOString(),
      reviewed_at: row.reviewed_at === null ? null : new Date(row.reviewed_at as Date | string).toISOString(),
    }));
    const last = rows[limit - 1];
    return {
      items,
      more: rows.length > limit,
      ...(rows.length > limit && last ? { cursor: encodeKeysetCursor([new Date(last.requested_at).toISOString()], last.id, filters) } : {}),
    };
  }

}
