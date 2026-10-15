import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { encodeKeysetCursor } from '../../../../packages/technical/src/pagination/keyset';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { decodeReportPairCursor } from './reports.helpers';
import { reportScopeSql } from './reports.scope';
import type { StockSummaryQueryDto } from './reports.dto';

interface StockSummaryRow {
  warehouse_id: string;
  item_id: string;
  item_name: string;
  unit_code: string;
  unit_name: string;
  unit_scale: number | string;
  on_hand: string;
  reserved: string;
  available: string;
  held: string;
  in_transit: string;
}

function reportFilters(userId: string, grants: readonly unknown[], query: StockSummaryQueryDto): Record<string, unknown> {
  return {
    route: 'logistics.reports.stock-summary', user_id: userId, grants,
    warehouse_id: query.warehouse_id ?? null,
  };
}

@Injectable()
export class StockReportService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async summary(query: StockSummaryQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const filters = reportFilters(session.userId, session.grants, query);
    const cursor = decodeReportPairCursor(query.cursor, filters);
    const warehouseValues: unknown[] = [];
    const warehouseConditions = [reportScopeSql(session.grants, ['REPORT_READ'], warehouseValues, 'w', ['SYSTEM', 'ORGANIZATION', 'REGION'])];

    if (query.warehouse_id) {
      warehouseValues.push(query.warehouse_id);
      warehouseConditions.push(`w.id=$${warehouseValues.length}::uuid`);
    }

    const values = [...warehouseValues];
    const conditions: string[] = [];
    if (cursor) {
      values.push(cursor.sort[0], cursor.sort[1]);
      conditions.push(`(inventory.warehouse_id,inventory.item_id)>($${values.length - 1}::uuid,$${values.length}::uuid)`);
    }

    const limit = query.limit ?? 50;
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `WITH visible_warehouses AS MATERIALIZED (
         SELECT w.id,w.organization_id,w.region_code
           FROM warehouse w
          WHERE ${warehouseConditions.join(' AND ')}
       ), held AS MATERIALIZED (
         SELECT receipt.warehouse_id,line.item_id,SUM(line.held_quantity)::text AS held
           FROM donation_receipt receipt
           JOIN visible_warehouses warehouse ON warehouse.id=receipt.warehouse_id
           JOIN LATERAL (SELECT MAX(revision) AS revision FROM receipt_count WHERE receipt_id=receipt.id) latest
             ON latest.revision IS NOT NULL
           JOIN receipt_count_line line ON line.receipt_id=receipt.id AND line.revision=latest.revision
          GROUP BY receipt.warehouse_id,line.item_id
       ), inventory AS MATERIALIZED (
         SELECT b.warehouse_id,b.item_id,b.on_hand,b.reserved
           FROM stock_balance b
           JOIN visible_warehouses warehouse ON warehouse.id=b.warehouse_id
         UNION ALL
         SELECT held.warehouse_id,held.item_id,0::numeric,0::numeric
           FROM held
          WHERE NOT EXISTS (
            SELECT 1 FROM stock_balance b
             WHERE b.warehouse_id=held.warehouse_id AND b.item_id=held.item_id
          )
       )
      SELECT inventory.warehouse_id,inventory.item_id,i.name AS item_name,
              un.code AS unit_code,un.display_name AS unit_name,un.scale AS unit_scale,
              inventory.on_hand::text AS on_hand,inventory.reserved::text AS reserved,
              (inventory.on_hand-inventory.reserved)::text AS available,
              COALESCE(held.held,'0') AS held,COALESCE(custody.in_transit,'0') AS in_transit
         FROM inventory
         JOIN item i ON i.id=inventory.item_id
         JOIN unit un ON un.code=i.unit_code
         LEFT JOIN held ON held.warehouse_id=inventory.warehouse_id AND held.item_id=inventory.item_id
         LEFT JOIN LATERAL (
           SELECT SUM(line.in_transit_quantity)::text AS in_transit
             FROM distribution_line line
            WHERE line.warehouse_id=inventory.warehouse_id AND line.item_id=inventory.item_id
         ) custody ON TRUE
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY inventory.warehouse_id ASC,inventory.item_id ASC LIMIT $${values.length}`,
      values,
    ) as StockSummaryRow[];

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        warehouse_id: row.warehouse_id,
        item: { id: row.item_id, name: row.item_name },
        unit: { code: row.unit_code, display_name: row.unit_name, scale: Number(row.unit_scale) },
        on_hand: row.on_hand,
        reserved: row.reserved,
        available: row.available,
        held: row.held,
        in_transit: row.in_transit,
      })),
      more: rows.length > limit,
      ...(rows.length > limit && last ? {
        cursor: encodeKeysetCursor([last.warehouse_id, last.item_id], last.item_id, filters),
      } : {}),
      generated_at: new Date().toISOString(),
    };
  }
}
