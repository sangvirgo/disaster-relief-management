import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { decodeReportIdCursor } from './reports.helpers';
import type { PublicDonationReportQueryDto } from './reports.dto';

interface DonationReportRow {
  item_id: string;
  item_name: string;
  unit_code: string;
  unit_name: string;
  unit_scale: number | string;
  quantity: string;
}

interface CachedReport {
  expiresAt: number;
  value: Record<string, unknown>;
}

const cacheTtlMs = 60_000;
const maxCacheEntries = 500;

@Injectable()
export class DonationReportService {
  private readonly cache = new Map<string, CachedReport>();

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async summary(query: PublicDonationReportQueryDto): Promise<Record<string, unknown>> {
    const selected = [
      query.drive_id ? { id: query.drive_id, view: 'DRIVE_ACCEPTED' as const } : undefined,
      query.campaign_id ? { id: query.campaign_id, view: 'CAMPAIGN_DISTRIBUTED' as const } : undefined,
      query.warehouse_id ? { id: query.warehouse_id, view: 'WAREHOUSE_DISTRIBUTED' as const } : undefined,
    ].filter((value) => value !== undefined);
    if (selected.length !== 1) throw new AppError('VALIDATION_FAILED', { status: 400 });
    const { id, view } = selected[0]!;
    const filters = { route: 'logistics.public.donation-reports.summary', view, filter_id: id };
    const cursor = decodeReportIdCursor(query.cursor, filters);
    const limit = query.limit ?? 50;
    const cacheKey = JSON.stringify({ ...filters, limit, cursor: query.cursor ?? null });
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) this.cache.delete(cacheKey);

    const values: unknown[] = [id];
    let filter: string;
    let metric: 'accepted' | 'distributed';
    if (view === 'DRIVE_ACCEPTED') {
      metric = 'accepted';
      filter = `drive.id=$1::uuid AND movement.movement_type IN ('RECEIPT','RECEIPT_HELD_RELEASE')`;
    } else {
      metric = 'distributed';
      filter = view === 'CAMPAIGN_DISTRIBUTED' ? 'supply.campaign_id=$1::uuid' : 'supply.warehouse_id=$1::uuid';
    }
    const after = cursor
      ? (values.push(cursor.id, cursor.id), `AND (item.id,item.id)>($${values.length - 1}::uuid,$${values.length}::uuid)`)
      : '';
    values.push(limit + 1);

    const sql = view === 'DRIVE_ACCEPTED'
      ? `SELECT item.id AS item_id,item.name AS item_name,unit.code AS unit_code,unit.display_name AS unit_name,
                unit.scale AS unit_scale,SUM(movement.delta_on_hand)::text AS quantity
           FROM stock_movement movement
           JOIN stock_balance balance ON balance.id=movement.balance_id
           JOIN donation_receipt receipt ON receipt.id=movement.receipt_id
           JOIN donation_delivery delivery ON delivery.id=receipt.delivery_id
           JOIN donation_drive drive ON drive.id=delivery.drive_id
           JOIN item ON item.id=balance.item_id JOIN unit ON unit.code=item.unit_code
          WHERE ${filter} ${after}
          GROUP BY item.id,unit.code ORDER BY item.id ASC LIMIT $${values.length}`
      // Goods handed to rescue teams through supply requests (issued and delivered in one step).
      : `SELECT item.id AS item_id,item.name AS item_name,unit.code AS unit_code,unit.display_name AS unit_name,
                unit.scale AS unit_scale,SUM(commitment.delivered_quantity)::text AS quantity
           FROM supply_request supply
           JOIN supply_request_line line ON line.supply_request_id=supply.id
           JOIN commitment ON commitment.id=line.commitment_id
           JOIN item ON item.id=line.item_id JOIN unit ON unit.code=item.unit_code
          WHERE supply.status='HANDED_OVER' AND ${filter} ${after}
          GROUP BY item.id,unit.code ORDER BY item.id ASC LIMIT $${values.length}`;

    const rows = await this.dataSource.query(sql, values) as DonationReportRow[];
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const result = {
      view,
      filter_id: id,
      items: page.map((row) => ({
        item: { id: row.item_id, name: row.item_name },
        unit: { code: row.unit_code, display_name: row.unit_name, scale: Number(row.unit_scale) },
        [metric]: row.quantity,
      })),
      more: rows.length > limit,
      ...(rows.length > limit && last ? { cursor: encodeKeysetCursor([last.item_id], last.item_id, filters) } : {}),
      generated_at: new Date().toISOString(),
    };

    while (this.cache.size >= maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    this.cache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, value: result });
    return result;
  }
}
