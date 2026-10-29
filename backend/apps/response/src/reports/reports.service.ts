import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { scopeSql } from '../operations/request-operations.helpers';
import { ReporterSessionService } from '../requests/reporter-session';
import { analyticsCacheKey, AnalyticsCache, dateWindowFilters } from '../analytics/analytics.helpers';
import { MISSIONS_CONFIG } from '../missions/missions.config';
import type { MissionsConfig } from '../missions/missions.config';
import { ReportSummaryQueryDto } from './reports.dto';

interface SummaryRow {
  status_counts: unknown;
  priority_counts: unknown;
  median_verified_seconds: number | string | null;
  median_offered_seconds: number | string | null;
  active_missions: number | string;
  overdue_missions: number | string;
}

@Injectable()
export class ReportsService {
  private readonly cache = new AnalyticsCache<Record<string, unknown>>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ReporterSessionService,
    @Inject(MISSIONS_CONFIG) private readonly config: MissionsConfig,
  ) {}

  async summary(query: ReportSummaryQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const filters = dateWindowFilters(query as unknown as Record<string, unknown>, 366);
    const values: unknown[] = [];
    const scope = scopeSql(session.grants, 'REPORT_READ', values, 'r');
    const clauses = [
      `r.received_at >= $${values.push(filters.from)}`,
      `r.received_at < $${values.push(filters.to)}`,
      scope,
    ];
    if (filters.region_code) clauses.push(`r.region_code=$${values.push(filters.region_code)}`);
    if (filters.campaign_id) clauses.push(`r.campaign_id=$${values.push(filters.campaign_id)}::uuid`);
    const overdueMinutes = values.push(this.config.offerOverdueMinutes);
    const key = analyticsCacheKey(session.userId, session.grants, { ...filters });
    const cached = this.cache.get(key);
    if (cached) return cached;

    const sql = `WITH filtered_requests AS MATERIALIZED (
      SELECT r.id, r.received_at, r.status::text AS status, r.priority::text AS priority
        FROM assistance_request r
       WHERE ${clauses.join('\n         AND ')}
    ), first_verified AS (
      SELECT d.request_id, MIN(d.decided_at) AS decided_at
        FROM verification_decision d JOIN filtered_requests f ON f.id=d.request_id
       WHERE d.outcome='VERIFIED'
       GROUP BY d.request_id
    ), first_mission_offer AS (
      SELECT m.request_id, MIN(m.created_at) AS created_at
        FROM mission m JOIN filtered_requests f ON f.id=m.request_id
       GROUP BY m.request_id
    )
    SELECT COALESCE((
             SELECT jsonb_object_agg(status, total)
               FROM (SELECT status, COUNT(*)::int AS total FROM filtered_requests GROUP BY status) counts
           ), '{}'::jsonb) AS status_counts,
           COALESCE((
             SELECT jsonb_object_agg(priority, total)
               FROM (SELECT priority, COUNT(*)::int AS total FROM filtered_requests WHERE priority IS NOT NULL GROUP BY priority) counts
           ), '{}'::jsonb) AS priority_counts,
           (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (v.decided_at-f.received_at)))
              FROM filtered_requests f JOIN first_verified v ON v.request_id=f.id) AS median_verified_seconds,
           (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (o.created_at-f.received_at)))
              FROM filtered_requests f JOIN first_mission_offer o ON o.request_id=f.id) AS median_offered_seconds,
           (SELECT COUNT(*)::int FROM mission m JOIN filtered_requests f ON f.id=m.request_id
             WHERE m.status IN ('OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE')) AS active_missions,
           (SELECT COUNT(*)::int FROM mission m JOIN filtered_requests f ON f.id=m.request_id
             WHERE m.status='OFFERED'
               AND m.created_at <= statement_timestamp()-($${overdueMinutes}::int*interval '1 minute')) AS overdue_missions`;

    const rows = await this.dataSource.query(sql, values) as SummaryRow[];
    if (!rows[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const result = {
      filters,
      status_counts: countObject(rows[0].status_counts),
      priority_counts: countObject(rows[0].priority_counts),
      median_seconds: {
        receipt_to_verification: nullableNumber(rows[0].median_verified_seconds),
        receipt_to_assignment: nullableNumber(rows[0].median_offered_seconds),
      },
      active_missions: safeCount(rows[0].active_missions),
      overdue_missions: safeCount(rows[0].overdue_missions),
      generated_at: new Date().toISOString(),
    };
    this.cache.set(key, result, 60_000);
    return result;
  }
}

function countObject(value: unknown): Record<string, number> {
  let counts = value;
  if (typeof value === 'string') {
    try {
      counts = JSON.parse(value) as unknown;
    } catch {
      throw new AppError('INTERNAL_ERROR', { status: 500 });
    }
  }
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) throw new AppError('INTERNAL_ERROR', { status: 500 });
  return Object.fromEntries(Object.entries(counts).map(([key, count]) => [key, safeCount(count as number | string, true)]));
}

function nullableNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new AppError('INTERNAL_ERROR', { status: 500 });
  return number;
}

function safeCount(value: number | string, allowZero = true): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < (allowZero ? 0 : 1)) throw new AppError('INTERNAL_ERROR', { status: 500 });
  return count;
}
