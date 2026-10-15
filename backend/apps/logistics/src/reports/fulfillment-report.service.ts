import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { encodeKeysetCursor } from '../../../../packages/technical/src/pagination/keyset';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { decodeReportIdCursor, reportWindow } from './reports.helpers';
import { reportScopeSql } from './reports.scope';
import type { FulfillmentReportQueryDto } from './reports.dto';

interface FulfillmentReportRow {
  need_id: string;
  request_id: string;
  cycle_id: string;
  work_cycle: number | string;
  region_code: string | null;
  campaign_id: string | null;
  item_id: string;
  item_name: string;
  unit_code: string;
  unit_name: string;
  unit_scale: number | string;
  original: string;
  reduced: string;
  cancelled_remaining: string;
  active_requested: string;
  delivered: string;
  active_outstanding: string;
  status: string;
}

function reportFilters(userId: string, grants: readonly unknown[], query: FulfillmentReportQueryDto): Record<string, unknown> {
  return {
    route: 'logistics.reports.fulfillment', user_id: userId, grants,
    campaign_id: query.campaign_id ?? null, region_code: query.region_code ?? null,
    from: query.from, to: query.to,
  };
}

@Injectable()
export class FulfillmentReportService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async summary(query: FulfillmentReportQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    if (!query.campaign_id && !query.region_code) throw new AppError('VALIDATION_FAILED', { status: 400 });
    const window = reportWindow(query.from, query.to);
    const filters = reportFilters(session.userId, session.grants, query);
    const cursor = decodeReportIdCursor(query.cursor, filters);
    const values: unknown[] = [];
    const conditions = [reportScopeSql(session.grants, ['REPORT_READ'], values, 'c')];

    if (query.campaign_id) {
      values.push(query.campaign_id);
      conditions.push(`c.campaign_id=$${values.length}::uuid`);
    }
    if (query.region_code) {
      values.push(query.region_code);
      conditions.push(`c.region_code=$${values.length}`);
    }
    values.push(window.from, window.to);
    conditions.push(`n.created_at >= $${values.length - 1}::timestamptz`);
    conditions.push(`n.created_at < $${values.length}::timestamptz`);
    if (cursor) {
      values.push(cursor.id, cursor.id);
      conditions.push(`(n.id,n.id)>($${values.length - 1}::uuid,$${values.length}::uuid)`);
    }

    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT n.id AS need_id,c.request_id,c.id AS cycle_id,c.work_cycle,c.region_code,c.campaign_id,
              n.item_id,i.name AS item_name,un.code AS unit_code,un.display_name AS unit_name,un.scale AS unit_scale,
              n.original_quantity::text AS original,
              GREATEST(n.original_quantity-n.requested_quantity,0)::text AS reduced,
              COALESCE(n.cancelled_remaining,0)::text AS cancelled_remaining,
              CASE WHEN n.status='CANCELLED' THEN '0'::numeric ELSE n.requested_quantity END::text AS active_requested,
              COALESCE(SUM(cm.delivered_quantity),0)::text AS delivered,
              CASE WHEN n.status='CANCELLED' THEN '0'::numeric
                   ELSE GREATEST(n.requested_quantity-COALESCE(SUM(cm.delivered_quantity),0),0) END::text AS active_outstanding,
              n.status
         FROM relief_need n
         JOIN fulfillment_cycle c ON c.id=n.cycle_id
         JOIN item i ON i.id=n.item_id
         JOIN unit un ON un.code=i.unit_code
         LEFT JOIN commitment cm ON cm.relief_need_id=n.id
        WHERE ${conditions.join(' AND ')}
        GROUP BY n.id,c.id,i.id,un.code
        ORDER BY n.id ASC LIMIT $${values.length}`,
      values,
    ) as FulfillmentReportRow[];

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        id: row.need_id,
        request_id: row.request_id,
        cycle_id: row.cycle_id,
        work_cycle: Number(row.work_cycle),
        region_code: row.region_code,
        campaign_id: row.campaign_id,
        item: { id: row.item_id, name: row.item_name },
        unit: { code: row.unit_code, display_name: row.unit_name, scale: Number(row.unit_scale) },
        original: row.original,
        reduced: row.reduced,
        cancelled_remaining: row.cancelled_remaining,
        active_requested: row.active_requested,
        delivered: row.delivered,
        active_outstanding: row.active_outstanding,
        status: row.status,
      })),
      more: rows.length > limit,
      ...(rows.length > limit && last ? { cursor: encodeKeysetCursor([last.need_id], last.need_id, filters) } : {}),
      generated_at: new Date().toISOString(),
    };
  }
}
