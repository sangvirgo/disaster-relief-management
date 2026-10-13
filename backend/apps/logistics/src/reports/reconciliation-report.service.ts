import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { encodeKeysetCursor } from '../../../../packages/technical/src/pagination/keyset';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { physicalHandoffsLateralSql } from './reconciliation-report.helpers';
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
  issued_in_transit: string;
  at_point: string;
  delivered: string;
  returned: string;
  lost: string;
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
      reportScopeSql(session.grants, ['REPORT_READ', 'DISTRIBUTION_REVIEW'], values, 'w', ['SYSTEM', 'ORGANIZATION', 'REGION']),
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
              COALESCE(custody.issued_in_transit,0)::text AS issued_in_transit,
              COALESCE(custody.at_point,0)::text AS at_point,
              (COALESCE(commitments.delivered,0)+COALESCE(physical_handoffs.delivered,0))::text AS delivered,
              (COALESCE(commitments.returned,0)+COALESCE(physical_handoffs.returned,0))::text AS returned,
              (COALESCE(commitments.lost,0)+COALESCE(physical_handoffs.lost,0))::text AS lost,
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
           SELECT SUM(line.in_transit_quantity) AS issued_in_transit,SUM(line.at_point_quantity) AS at_point
             FROM distribution_line line
            WHERE line.warehouse_id=b.warehouse_id AND line.item_id=b.item_id
         ) custody ON TRUE
         LEFT JOIN LATERAL (
           SELECT SUM(commitment.delivered_quantity) AS delivered,
                  SUM(commitment.returned_quantity) AS returned,
                  SUM(commitment.lost_quantity) AS lost,
                  BOOL_OR(
                    commitment.delivered_quantity<>COALESCE(settlements.delivered,0) OR
                    commitment.returned_quantity<>COALESCE(settlements.returned,0) OR
                    commitment.lost_quantity<>COALESCE(settlements.lost,0)
                  ) AS counter_mismatch
             FROM commitment
             LEFT JOIN LATERAL (
               SELECT SUM(line.quantity) FILTER (WHERE settlement.settlement_type='DELIVERED') AS delivered,
                      SUM(line.quantity) FILTER (WHERE settlement.settlement_type='RETURNED') AS returned,
                      SUM(line.quantity) FILTER (WHERE settlement.settlement_type='LOST') AS lost
                 FROM issued_line_settlement settlement
                 JOIN handoff_line line ON line.id=settlement.handoff_line_id
                WHERE settlement.commitment_id=commitment.id
             ) settlements ON TRUE
            WHERE commitment.warehouse_id=b.warehouse_id AND commitment.item_id=b.item_id
         ) commitments ON TRUE
         ${physicalHandoffsLateralSql}
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
        issued_in_transit: row.issued_in_transit,
        at_point: row.at_point,
        delivered: row.delivered,
        returned: row.returned,
        lost: row.lost,
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
    const scope = reportScopeSql(grants, ['REPORT_READ', 'DISTRIBUTION_REVIEW'], values, 'w', ['SYSTEM', 'ORGANIZATION', 'REGION']);
    const rows = await this.dataSource.query(
      `SELECT w.id FROM warehouse w WHERE w.id=$1::uuid AND ${scope} LIMIT 1`,
      values,
    ) as Array<{ id: string }>;
    return rows.length > 0;
  }
}
