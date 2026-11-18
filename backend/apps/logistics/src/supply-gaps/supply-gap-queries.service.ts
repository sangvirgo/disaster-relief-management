import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { SupplyGapQueryDto } from './supply-gaps.dto';
import {
  readSupplyGap, requireSupplyGapPermission, SUPPLY_GAP_VIEW_SQL, SupplyGapViewRow, supplyGapView, supplyGapViewParams,
} from './supply-gaps.helpers';

function validCursor(cursor: ReturnType<typeof decodeKeysetCursor>): boolean {
  const [sort] = cursor.sort;
  return cursor.sort.length === 1 && typeof sort === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(sort) && Number.isFinite(Date.parse(sort)) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(cursor.id);
}

/** Read-only views of supply gaps for COORDINATOR and OPERATIONS_MANAGER (SUPPLY_GAP_VIEW). */
@Injectable()
export class SupplyGapQueriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async list(query: SupplyGapQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    requireSupplyGapPermission(session, 'SUPPLY_GAP_VIEW');
    const filters = { route: 'logistics.supply-gaps', status: query.status ?? null, warehouse_id: query.warehouse_id ?? null };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : null;
    if (cursor && !validCursor(cursor)) throw new AppError('CURSOR_INVALID', { status: 400 });

    const values: unknown[] = [...supplyGapViewParams()];
    const conditions: string[] = [];
    if (query.status) {
      values.push(query.status);
      conditions.push(`g.status=$${values.length}`);
    }
    if (query.warehouse_id) {
      values.push(query.warehouse_id);
      conditions.push(`g.warehouse_id=$${values.length}::uuid`);
    }
    if (cursor) {
      values.push(cursor.sort[0], cursor.id);
      conditions.push(`(g.created_at,g.id)<($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
    }
    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = await this.dataSource.query(
      `${SUPPLY_GAP_VIEW_SQL} ${where} ORDER BY g.created_at DESC,g.id DESC LIMIT $${values.length}`,
      values,
    ) as SupplyGapViewRow[];
    const page = rows.slice(0, limit);
    const more = rows.length > limit;
    const last = page.at(-1);
    return {
      items: page.map(supplyGapView),
      more,
      ...(more && last ? { cursor: encodeKeysetCursor([last.cursor_created_at], last.id, filters) } : {}),
      generated_at: new Date().toISOString(),
    };
  }

  async detail(id: string, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    requireSupplyGapPermission(session, 'SUPPLY_GAP_VIEW');
    return readSupplyGap(this.dataSource, id);
  }
}
