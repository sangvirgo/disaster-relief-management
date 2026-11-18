import { AppError } from '@c48/technical/errors/errors';
import { hasPermission, Permission } from '@c48/identity-contracts/permissions';
import type { AuthenticatedLogisticsSession } from '../auth/logistics-session.service';
import { decimalFromUnits, quantityUnits } from '../common/quantity';
import { supplyGapReasonViews } from './supply-gap-reasons';

/** Campaign statuses whose PRIMARY warehouse counts for demand. DRAFT and CLOSED campaigns are ignored. */
export const SUPPLY_GAP_PRIMARY_STATUSES = ['ACTIVE', 'PAUSED'] as const;
/** relief_need statuses that still need goods. FULFILLED and CANCELLED lines are not demand. */
export const SUPPLY_GAP_LIVE_NEED_STATUSES = ['OPEN', 'PARTIALLY_FULFILLED'] as const;

/** Supply gaps are system-wide warehouse decisions, so only SYSTEM grants satisfy them (campaign target is null). */
export function requireSupplyGapPermission(session: AuthenticatedLogisticsSession, permission: Permission): void {
  if (!hasPermission(session.grants, permission, { campaignId: null })) {
    throw new AppError('FORBIDDEN', { status: 403 });
  }
}

/** Normalizes a stored numeric(18,3) text to the item's unit scale, e.g. "12.000" at scale 0 becomes "12". */
export function decimalAtScale(value: string, scale: number): string {
  return decimalFromUnits(quantityUnits(value, scale), scale);
}

export function iso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/** Parameters $1 (live need statuses) and $2 (primary campaign statuses) are reserved by SUPPLY_GAP_VIEW_SQL. */
export function supplyGapViewParams(): unknown[] {
  return [[...SUPPLY_GAP_LIVE_NEED_STATUSES], [...SUPPLY_GAP_PRIMARY_STATUSES]];
}

/**
 * Shared SELECT for one supply gap with its names and the live ESTIMATED forecast for the same warehouse and item.
 * The forecast is computed on read, never stored, so it stays out of demand (proposal section 3.3).
 */
export const SUPPLY_GAP_VIEW_SQL = `
  SELECT g.id,g.status,g.severity,g.warehouse_id,w.name AS warehouse_name,g.item_id,i.name AS item_name,
         u.code AS unit_code,u.scale,g.demand::text AS demand,g.supply::text AS supply,g.pledged::text AS pledged,
         g.gap_qty::text AS gap_qty,g.campaign_ids,g.backup_warehouse_ids,g.reason_codes,g.draft,g.drive_id,
         g.dismissed_reason,g.dismissed_until,g.computed_at,g.version,g.created_at,g.updated_at,
         to_char(g.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at,
         (SELECT COALESCE(SUM(x.unmet),0)::text FROM (
            SELECT GREATEST(rn.requested_quantity - COALESCE(SUM(c.quantity - c.released_quantity),0),0) AS unmet
              FROM relief_need rn JOIN fulfillment_cycle fc ON fc.id=rn.cycle_id
              LEFT JOIN commitment c ON c.relief_need_id=rn.id
             WHERE rn.item_id=g.item_id AND rn.source='ESTIMATED' AND rn.status = ANY($1::text[])
               AND fc.campaign_id IN (
                 SELECT cw.campaign_id FROM campaign_warehouse cw JOIN campaign_area_snapshot s ON s.campaign_id=cw.campaign_id
                  WHERE cw.warehouse_id=g.warehouse_id AND cw.role='PRIMARY' AND s.status = ANY($2::text[]))
             GROUP BY rn.id,rn.requested_quantity) x) AS forecast_demand
    FROM supply_gap g
    JOIN warehouse w ON w.id=g.warehouse_id
    JOIN item i ON i.id=g.item_id
    JOIN unit u ON u.code=i.unit_code`;

export interface SupplyGapViewRow extends Record<string, unknown> {
  id: string;
  status: string;
  severity: string;
  warehouse_id: string;
  warehouse_name: string;
  item_id: string;
  item_name: string;
  unit_code: string;
  scale: number;
  demand: string;
  supply: string;
  pledged: string;
  gap_qty: string;
  campaign_ids: string[];
  backup_warehouse_ids: string[];
  reason_codes: string[];
  draft: Record<string, unknown>;
  drive_id: string | null;
  dismissed_reason: string | null;
  dismissed_until: Date | string | null;
  computed_at: Date | string;
  version: number | string;
  created_at: Date | string;
  updated_at: Date | string;
  forecast_demand: string;
  cursor_created_at: string;
}

export function supplyGapView(row: SupplyGapViewRow): Record<string, unknown> {
  const scale = Number(row.scale);
  return {
    id: row.id,
    status: row.status,
    severity: row.severity,
    warehouse_id: row.warehouse_id,
    warehouse_name: row.warehouse_name,
    item_id: row.item_id,
    item_name: row.item_name,
    unit_code: row.unit_code,
    scale,
    demand: decimalAtScale(row.demand, scale),
    supply: decimalAtScale(row.supply, scale),
    pledged: decimalAtScale(row.pledged, scale),
    gap_qty: decimalAtScale(row.gap_qty, scale),
    forecast_demand: decimalAtScale(row.forecast_demand, scale),
    campaign_ids: row.campaign_ids,
    backup_warehouse_ids: row.backup_warehouse_ids,
    reason_codes: row.reason_codes,
    reasons: supplyGapReasonViews(row.reason_codes),
    draft: row.draft,
    drive_id: row.drive_id,
    dismissed_reason: row.dismissed_reason,
    dismissed_until: iso(row.dismissed_until),
    computed_at: iso(row.computed_at),
    version: Number(row.version),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}

export async function readSupplyGap(
  query: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  id: string,
): Promise<Record<string, unknown>> {
  const rows = await query.query(
    `${SUPPLY_GAP_VIEW_SQL} WHERE g.id=$3`,
    [...supplyGapViewParams(), id],
  ) as SupplyGapViewRow[];
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', { status: 404 });
  return supplyGapView(row);
}

export function assertSupplyGapOpen(status: string): void {
  if (status !== 'OPEN') throw new AppError('SUPPLY_GAP_NOT_OPEN', { status: 409 });
}
