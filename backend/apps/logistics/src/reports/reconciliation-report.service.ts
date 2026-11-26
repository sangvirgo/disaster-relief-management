import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { decodeReportIdCursor } from './reports.helpers';
import { reportScopeSql } from './reports.scope';
import type { ReconciliationQueryDto } from './reports.dto';

interface ReconciliationRow {
  balance_id: string;
  item_id: string;
  item_name: string;
  unit_code: string;
  unit_name: string;
  unit_scale: number | string;
  intake_accepted: string;
  posted_movements: string;
  posted_reserved_movements: string;
  reserved: string;
  delivered: string;
  balance_mismatch: boolean;
  commitment_counter_mismatch: boolean;
}

function reportFilters(userId: string, grants: readonly unknown[], query: ReconciliationQueryDto): Record<string, unknown> {
  return {
    route: 'logistics.reconciliation', user_id: userId, grants,
    warehouse_id: query.warehouse_id, item_id: query.item_id ?? null,
  };
}

@Injectable()
export class ReconciliationReportService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async summary(query: ReconciliationQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const authorizedWarehouse = await this.authorizedWarehouse(query.warehouse_id, session.grants);
    if (!authorizedWarehouse) throw new AppError('NOT_FOUND', { status: 404 });

    const filters = reportFilters(session.userId, session.grants, query);
    const cursor = decodeReportIdCursor(query.cursor, filters);
    const values: unknown[] = [];
    const conditions = [
      reportScopeSql(session.grants, ['REPORT_READ'], values, 'w', ['SYSTEM']),
    ];
    values.push(query.warehouse_id);
    conditions.push(`b.warehouse_id=$${values.length}::uuid`);
    if (query.item_id) {
      values.push(query.item_id);
      conditions.push(`b.item_id=$${values.length}::uuid`);
    }
    if (cursor) {
      values.push(cursor.id, cursor.id);
      conditions.push(`(b.id,b.id)>($${values.length - 1}::uuid,$${values.length}::uuid)`);
    }
    const limit = query.limit ?? 50;
    values.push(limit + 1);

    const rows = await this.dataSource.query(
      `SELECT b.id AS balance_id,b.item_id,i.name AS item_name,unit.code AS unit_code,
              unit.display_name AS unit_name,unit.scale AS unit_scale,
              COALESCE(movements.intake_accepted,0)::text AS intake_accepted,
              COALESCE(movements.posted_movements,0)::text AS posted_movements,
              COALESCE(movements.posted_reserved_movements,0)::text AS posted_reserved_movements,
              b.reserved::text AS reserved,
              COALESCE(commitments.delivered,0)::text AS delivered,
              (b.on_hand<>COALESCE(movements.posted_movements,0) OR
               b.reserved<>COALESCE(movements.posted_reserved_movements,0)) AS balance_mismatch,
              COALESCE(commitments.counter_mismatch,false) AS commitment_counter_mismatch
         FROM stock_balance b
         JOIN warehouse w ON w.id=b.warehouse_id
         JOIN item i ON i.id=b.item_id
         JOIN unit ON unit.code=i.unit_code
         LEFT JOIN LATERAL (
           SELECT SUM(movement.delta_on_hand) AS posted_movements,
                  SUM(movement.delta_reserved) AS posted_reserved_movements,
                  SUM(movement.delta_on_hand) FILTER (
                    WHERE movement.movement_type IN ('RECEIPT','RECEIPT_HELD_RELEASE')
                  ) AS intake_accepted
             FROM stock_movement movement WHERE movement.balance_id=b.id
         ) movements ON TRUE
         LEFT JOIN LATERAL (
           -- Supply hand-over issues and delivers in one step, so delivered must equal issued, and issued must equal the
           -- ISSUE movements written for the commitment.
           SELECT SUM(commitment.delivered_quantity) AS delivered,
                  BOOL_OR(
                    commitment.delivered_quantity<>commitment.issued_quantity OR
                    commitment.issued_quantity<>COALESCE(issues.issued,0)
                  ) AS counter_mismatch
             FROM commitment
             LEFT JOIN LATERAL (
               SELECT -SUM(movement.delta_on_hand) AS issued
                 FROM stock_movement movement
                WHERE movement.commitment_id=commitment.id AND movement.movement_type='ISSUE'
             ) issues ON TRUE
            WHERE commitment.warehouse_id=b.warehouse_id AND commitment.item_id=b.item_id
         ) commitments ON TRUE
        WHERE ${conditions.join(' AND ')}
        ORDER BY b.id ASC LIMIT $${values.length}`,
      values,
    ) as ReconciliationRow[];

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        item: { id: row.item_id, name: row.item_name },
        unit: { code: row.unit_code, display_name: row.unit_name, scale: Number(row.unit_scale) },
        intake_accepted: row.intake_accepted,
        posted_movements: row.posted_movements,
        posted_reserved_movements: row.posted_reserved_movements,
        reserved: row.reserved,
        delivered: row.delivered,
        flags: {
          balance_mismatch: row.balance_mismatch,
          commitment_counter_mismatch: row.commitment_counter_mismatch,
        },
      })),
      more: rows.length > limit,
      ...(rows.length > limit && last ? { cursor: encodeKeysetCursor([last.balance_id], last.balance_id, filters) } : {}),
      generated_at: new Date().toISOString(),
    };
  }

  private async authorizedWarehouse(warehouseId: string, grants: Parameters<typeof reportScopeSql>[0]): Promise<boolean> {
    const values: unknown[] = [warehouseId];
    const scope = reportScopeSql(grants, ['REPORT_READ'], values, 'w', ['SYSTEM']);
    const rows = await this.dataSource.query(
      `SELECT w.id FROM warehouse w WHERE w.id=$1::uuid AND ${scope} LIMIT 1`,
      values,
    ) as Array<{ id: string }>;
    return rows.length > 0;
  }
}
