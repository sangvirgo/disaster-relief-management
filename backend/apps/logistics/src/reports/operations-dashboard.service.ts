import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { ROLE_PERMISSIONS } from '@c48/identity-contracts/permissions';
import type { Grant, Permission } from '@c48/identity-contracts/permissions';
import { AppError } from '@c48/technical/errors/errors';
import { LogisticsSessionService } from '../auth/logistics-session.service';

/** `null` means every organization (system administrator); an empty list means no access. */
type OrgScope = string[] | null;

export function scopeFor(grants: readonly Grant[], permissions: readonly Permission[]): OrgScope {
  const orgs = new Set<string>();
  for (const grant of grants) {
    const allowed: readonly string[] = ROLE_PERMISSIONS[grant.role_code];
    if (!permissions.some((permission) => allowed.includes(permission))) continue;
    if (grant.scope_type === 'SYSTEM') {
      if (grant.role_code === 'ADMIN' && grant.organization_id === null) return null;
      continue;
    }
    if (grant.organization_id) orgs.add(grant.organization_id);
  }
  return [...orgs];
}

const n = (value: unknown): number => Number(value ?? 0);
const counts = (rows: { key: string; total: number | string }[]): Record<string, number> =>
  Object.fromEntries(rows.map((row) => [row.key, n(row.total)]));
const lowThreshold = (): number => {
  const value = Number(process.env.STOCK_LOW_THRESHOLD ?? 50);
  return Number.isFinite(value) && value >= 0 ? value : 50;
};

/**
 * Counts for the warehouse, receiving and distribution staff. Each section appears only when one of the
 * caller's grants carries the matching permission, and is limited to that grant's organization.
 */
@Injectable()
export class OperationsDashboardService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: LogisticsSessionService,
  ) {}

  private q<T>(sql: string, scope: OrgScope): Promise<T[]> {
    return this.dataSource.query(sql, [scope]) as Promise<T[]>;
  }

  async overview(request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const g = session.grants;
    const intake = scopeFor(g, ['DONATION_INTAKE', 'DONATION_REVIEW', 'DONATION_DRIVE_MANAGE', 'REPORT_READ']);
    const distribution = scopeFor(g, ['DISTRIBUTION_PREPARE', 'DISTRIBUTION_REVIEW', 'DISTRIBUTION_DISPATCH', 'HANDOFF_RECORD', 'REPORT_READ']);
    const stock = scopeFor(g, ['REPORT_READ', 'STOCK_ADJUST_REQUEST', 'ADJUSTMENT_REVIEW', 'DISTRIBUTION_PREPARE', 'DONATION_INTAKE', 'DONATION_REVIEW']);
    const needs = scopeFor(g, ['NEED_MANAGE', 'REPORT_READ']);
    if ([intake, distribution, stock, needs].every((scope) => scope !== null && scope.length === 0)) {
      throw new AppError('FORBIDDEN', { status: 403 });
    }
    const visible = (scope: OrgScope): boolean => scope === null || scope.length > 0;
    const inOrg = (column: string): string => `($1::uuid[] IS NULL OR ${column} = ANY($1::uuid[]))`;
    const out: Record<string, unknown> = {};

    if (visible(intake)) {
      const [deliveries, openDisputes, drives, reviews7d] = await Promise.all([
        this.q<{ key: string; total: number }>(`SELECT status AS key, COUNT(*)::int AS total FROM donation_delivery d WHERE ${inOrg('d.organization_id')} GROUP BY status`, intake),
        this.q<{ total: number }>(`SELECT COUNT(*)::int AS total FROM donation_dispute x JOIN donation_delivery d ON d.id = x.delivery_id WHERE x.status = 'OPEN' AND ${inOrg('d.organization_id')}`, intake),
        this.q<{ key: string; total: number }>(`SELECT status AS key, COUNT(*)::int AS total FROM donation_drive d WHERE ${inOrg('d.organization_id')} GROUP BY status`, intake),
        this.q<{ key: string; total: number }>(`SELECT r.decision AS key, COUNT(*)::int AS total FROM receipt_review r JOIN donation_delivery d ON d.id = r.delivery_id WHERE r.reviewed_at >= now() - interval '7 days' AND ${inOrg('d.organization_id')} GROUP BY r.decision`, intake),
      ]);
      const byStatus = counts(deliveries);
      out.intake = {
        deliveries_by_status: byStatus,
        awaiting_count_or_review: n(byStatus.DECLARED) + n(byStatus.PENDING_REVIEW),
        pending_review: n(byStatus.PENDING_REVIEW),
        open_disputes: n(openDisputes[0]?.total),
        drives_by_status: counts(drives),
        reviews_last_7d: counts(reviews7d),
      };
    }
    if (visible(distribution)) {
      const [rows, unreconciled, handoffs] = await Promise.all([
        this.q<{ key: string; total: number }>(`SELECT status AS key, COUNT(*)::int AS total FROM distribution d WHERE ${inOrg('d.organization_id')} GROUP BY status`, distribution),
        this.q<{ total: number }>(`SELECT COUNT(*)::int AS total FROM distribution d WHERE d.status = 'DISPATCHED' AND ${inOrg('d.organization_id')}`, distribution),
        this.q<{ total: number }>(`SELECT COUNT(*)::int AS total FROM handoff_record h JOIN distribution d ON d.id = h.distribution_id WHERE h.occurred_at >= now() - interval '7 days' AND ${inOrg('d.organization_id')}`, distribution),
      ]);
      out.distribution = {
        by_status: counts(rows),
        dispatched_not_reconciled: n(unreconciled[0]?.total),
        handoffs_last_7d: n(handoffs[0]?.total),
      };
    }
    if (visible(stock)) {
      const threshold = lowThreshold();
      const [warehouses, levels, adjustments] = await Promise.all([
        this.q<{ total: number }>(`SELECT COUNT(*)::int AS total FROM warehouse w WHERE w.status = 'ACTIVE' AND ${inOrg('w.organization_id')}`, stock),
        this.dataSource.query(
          `SELECT COUNT(*) FILTER (WHERE avail <= 0)::int AS out_of_stock,
                  COUNT(*) FILTER (WHERE avail > 0 AND avail <= $2)::int AS low,
                  COUNT(*)::int AS tracked
             FROM (SELECT b.warehouse_id, b.item_id, (b.on_hand - b.reserved) AS avail
                     FROM stock_balance b JOIN warehouse w ON w.id = b.warehouse_id
                    WHERE ${inOrg('w.organization_id')}) x`,
          [stock, threshold]) as Promise<{ out_of_stock: number; low: number; tracked: number }[]>,
        this.q<{ total: number }>(`SELECT COUNT(*)::int AS total FROM stock_adjustment a JOIN stock_balance b ON b.id = a.balance_id JOIN warehouse w ON w.id = b.warehouse_id WHERE a.status = 'PENDING' AND ${inOrg('w.organization_id')}`, stock),
      ]);
      out.stock = {
        warehouses: n(warehouses[0]?.total),
        tracked_item_lines: n(levels[0]?.tracked),
        out_of_stock_lines: n(levels[0]?.out_of_stock),
        low_stock_lines: n(levels[0]?.low),
        pending_adjustments: n(adjustments[0]?.total),
        low_threshold_units: threshold,
      };
    }
    if (visible(needs)) {
      const rows = await this.q<{ key: string; total: number }>(
        `SELECT n.status AS key, COUNT(*)::int AS total FROM relief_need n JOIN fulfillment_cycle c ON c.id = n.cycle_id WHERE ${inOrg('c.organization_id')} GROUP BY n.status`, needs);
      const byStatus = counts(rows);
      out.needs = { by_status: byStatus, outstanding: n(byStatus.OPEN) + n(byStatus.PARTIALLY_FULFILLED) };
    }
    out.generated_at = new Date().toISOString();
    return out;
  }
}
