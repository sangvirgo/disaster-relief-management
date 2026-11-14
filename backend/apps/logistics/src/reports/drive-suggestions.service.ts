import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { LogisticsSessionService } from '../auth/logistics-session.service';
import { reportScopeSql } from './reports.scope';

type Severity = 'INFO' | 'WARNING' | 'URGENT';

export interface DriveSuggestion {
  code: 'STOCK_OUT' | 'STOCK_SHORTFALL' | 'STOCK_LOW' | 'WEATHER_NO_DRIVE' | 'NO_OPEN_DRIVE';
  severity: Severity;
  item_ids: string[];
  message: string;
}

interface StockRow { item_id: string; item_name: string; unit_name: string; available: string; open_need: string }
interface DriveRow { id: string; title: string; closes_at: Date | null; item_ids: string[] }
interface WeatherAlertResponse {
  locations?: { name: string; alerts: { code: string; level: string }[] }[];
}

const SEVERITY_ORDER: Record<Severity, number> = { URGENT: 3, WARNING: 2, INFO: 1 };

export type StockKind = 'STOCK_OUT' | 'STOCK_SHORTFALL' | 'STOCK_LOW';

/** Out of stock beats shortfall against open needs, which beats merely low stock. */
export function classifyStock(available: number, openNeed: number, lowThreshold: number): StockKind | null {
  if (available <= 0) return 'STOCK_OUT';
  if (openNeed > available) return 'STOCK_SHORTFALL';
  if (available <= lowThreshold) return 'STOCK_LOW';
  return null;
}

function lowThreshold(): number {
  const value = Number(process.env.STOCK_LOW_THRESHOLD ?? 50);
  return Number.isFinite(value) && value >= 0 ? value : 50;
}

/**
 * Rule-based advice for staff who decide whether to open a donation drive. It only suggests:
 * a person still creates the drive. Inputs: stock available per item, open needs that still
 * have to be met, currently open drives and forecast-based weather warnings.
 */
@Injectable()
export class DriveSuggestionsService {
  private readonly logger = new Logger(DriveSuggestionsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
  ) {}

  async suggestions(request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const warehouseValues: unknown[] = [];
    const warehouseScope = reportScopeSql(session.grants, ['REPORT_READ'], warehouseValues, 'w', ['SYSTEM']);
    const needValues: unknown[] = [];
    const needScope = reportScopeSql(session.grants, ['REPORT_READ'], needValues, 'c', ['SYSTEM', 'CAMPAIGN']);

    const [stockRows, driveRows, weather] = await Promise.all([
      this.dataSource.query(`
        WITH visible AS (SELECT w.id FROM warehouse w WHERE ${warehouseScope}),
        stock AS (
          SELECT b.item_id, SUM(b.on_hand - b.reserved) AS available
            FROM stock_balance b JOIN visible v ON v.id = b.warehouse_id GROUP BY b.item_id
        ), needs AS (
          SELECT n.item_id, SUM(n.requested_quantity - n.cancelled_remaining) AS open_need
            FROM relief_need n JOIN fulfillment_cycle c ON c.id = n.cycle_id
           WHERE n.status IN ('OPEN','PARTIALLY_FULFILLED') AND ${needScope.replace(/\$(\d+)/g, (_m, i: string) => `$${Number(i) + warehouseValues.length}`)}
           GROUP BY n.item_id
        )
        SELECT s.item_id, i.name AS item_name, u.display_name AS unit_name,
               s.available::text AS available, COALESCE(nd.open_need, 0)::text AS open_need
          FROM stock s JOIN item i ON i.id = s.item_id AND i.status = 'ACTIVE' JOIN unit u ON u.code = i.unit_code
          LEFT JOIN needs nd ON nd.item_id = s.item_id`,
        [...warehouseValues, ...needValues]),
      this.dataSource.query(`
        SELECT d.id, d.title, d.closes_at,
               COALESCE((SELECT array_agg(di.item_id) FROM drive_item di WHERE di.drive_id = d.id), '{}') AS item_ids
          FROM donation_drive d JOIN warehouse w ON w.id = d.intake_warehouse_id
         WHERE d.status = 'OPEN' AND (d.closes_at IS NULL OR d.closes_at > now()) AND ${warehouseScope}`,
        warehouseValues),
      this.weatherAlerts(),
    ]);

    const drives = driveRows as DriveRow[];
    const covered = (itemId: string): boolean => drives.some((drive) => drive.item_ids.includes(itemId));
    const threshold = lowThreshold();
    const suggestions: DriveSuggestion[] = [];

    const uncovered = new Map<StockKind, { severity: Severity; rows: StockRow[] }>();
    for (const row of stockRows as StockRow[]) {
      const available = Number(row.available);
      const need = Number(row.open_need);
      const kind = classifyStock(available, need, threshold);
      if (!kind || covered(row.item_id)) continue;
      const entry = uncovered.get(kind) ?? { severity: kind === 'STOCK_OUT' ? 'URGENT' : kind === 'STOCK_SHORTFALL' ? 'WARNING' : 'INFO', rows: [] };
      entry.rows.push(row);
      uncovered.set(kind, entry);
    }
    for (const [code, { severity, rows }] of uncovered) {
      const names = rows.map((row) => row.item_name).join(', ');
      const lead = code === 'STOCK_OUT' ? 'Đã hết hàng' : code === 'STOCK_SHORTFALL' ? 'Tồn kho không đủ cho nhu cầu đang mở' : `Tồn kho thấp (≤ ${threshold} đơn vị)`;
      suggestions.push({
        code, severity, item_ids: rows.map((row) => row.item_id),
        message: `${lead}: ${names}. Chưa có đợt tiếp nhận đang mở cho các mặt hàng này, nên cân nhắc tạo đợt quyên góp.`,
      });
    }

    const warnedPlaces = (weather.locations ?? [])
      .filter((location) => location.alerts.some((alert) => alert.level === 'WARNING' || alert.level === 'SEVERE'))
      .map((location) => location.name);
    if (warnedPlaces.length > 0 && drives.length === 0) {
      suggestions.push({
        code: 'WEATHER_NO_DRIVE', severity: 'WARNING', item_ids: [],
        message: `Dự báo thời tiết xấu (${warnedPlaces.join(', ')}) nhưng chưa có đợt tiếp nhận nào đang mở. Nên chuẩn bị đợt quyên góp trước khi thiên tai xảy ra.`,
      });
    }

    if (!drives.length && !suggestions.length) {
      suggestions.push({ code: 'NO_OPEN_DRIVE', severity: 'INFO', item_ids: [], message: 'Hiện không có đợt tiếp nhận nào đang mở; tồn kho và thời tiết chưa có dấu hiệu bất thường.' });
    }
    suggestions.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);

    return {
      open_drives: drives.map((drive) => ({ id: drive.id, title: drive.title, closes_at: drive.closes_at })),
      suggestions,
      weather_available: weather.available,
      thresholds: { stock_low_units: threshold },
      generated_at: new Date().toISOString(),
    };
  }

  private async weatherAlerts(): Promise<{ available: boolean } & WeatherAlertResponse> {
    const base = process.env.RESPONSE_BASE_URL ?? '';
    if (!base) return { available: false };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_000);
    try {
      const response = await fetch(`${base.replace(/\/$/u, '')}/api/v1/response/weather/alerts?active_only=true`, { signal: controller.signal });
      if (!response.ok) return { available: false };
      return { available: true, ...(await response.json() as WeatherAlertResponse) };
    } catch (error) {
      this.logger.warn(`WEATHER_LOOKUP_FAILED ${error instanceof Error ? error.name : 'unknown'}`);
      return { available: false };
    } finally {
      clearTimeout(timer);
    }
  }
}
