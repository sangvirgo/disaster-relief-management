import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import type { Grant } from '@c48/identity-contracts/permissions';
import { scopeSql } from '../operations/request-operations.helpers';
import { ReporterSessionService } from '../requests/reporter-session';
import { MISSIONS_CONFIG } from '../missions/missions.config';
import type { MissionsConfig } from '../missions/missions.config';

const CLOSED = "('RESOLVED','REJECTED','DUPLICATE','CANCELLED')";
const ACTIVE_MISSION = "('OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE')";

function envMinutes(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isSafeInteger(value) && value > 0 && value <= 1_440 ? value : fallback;
}
const n = (value: unknown): number => Number(value ?? 0);
const toMap = (value: unknown): Record<string, number> => {
  const source = (typeof value === 'string' ? JSON.parse(value) : value ?? {}) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(source).map(([key, total]) => [key, n(total)]));
};

@Injectable()
export class DashboardService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ReporterSessionService,
    @Inject(MISSIONS_CONFIG) private readonly missions: MissionsConfig,
  ) {}

  private scoped(grants: readonly Grant[], alias: string, extra: unknown[] = []): { where: string; values: unknown[] } {
    const values: unknown[] = [];
    const where = scopeSql(grants, 'REPORT_READ', values, alias);
    values.push(...extra);
    return { where, values };
  }

  /**
   * Live operational snapshot for coordinators (their own scope) and administrators (system-wide).
   * Counts only: no reporter identity, contact details, or free text is returned.
   */
  async overview(request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const verifyOverdue = envMinutes('VERIFY_OVERDUE_MINUTES', 15);
    const positionFresh = envMinutes('TEAM_POSITION_FRESH_MINUTES', 30);
    const offerOverdue = this.missions.offerOverdueMinutes;

    const rq = this.scoped(session.grants, 'r');
    const mq = this.scoped(session.grants, 'r');
    const tq = this.scoped(session.grants, 't');
    const cq = this.scoped(session.grants, 'r');
    const verifyParam = `$${rq.values.length + 1}`;
    const offerParam = `$${mq.values.length + 1}`;
    const freshParam = `$${tq.values.length + 1}`;

    const [requestRows, missionRows, teamRows, recentRows] = await Promise.all([
      this.dataSource.query(`
        WITH scoped AS MATERIALIZED (
          SELECT r.id, r.status, r.priority, r.incident_category_code AS category, r.received_at,
                 r.reporter_declared_danger AS danger
            FROM assistance_request r WHERE ${rq.where}
        ), open_requests AS (SELECT * FROM scoped WHERE status NOT IN ${CLOSED})
        SELECT
          (SELECT COALESCE(jsonb_object_agg(status, c), '{}') FROM (SELECT status, COUNT(*)::int c FROM open_requests GROUP BY 1) x) AS open_by_status,
          (SELECT COALESCE(jsonb_object_agg(priority, c), '{}') FROM (SELECT priority, COUNT(*)::int c FROM open_requests WHERE priority IS NOT NULL GROUP BY 1) x) AS open_by_priority,
          (SELECT COALESCE(jsonb_object_agg(category, c), '{}') FROM (SELECT category, COUNT(*)::int c FROM open_requests GROUP BY 1) x) AS open_by_category,
          (SELECT COUNT(*)::int FROM scoped WHERE received_at >= now() - interval '24 hours') AS received_24h,
          (SELECT COUNT(*)::int FROM scoped WHERE status = 'RESOLVED') AS resolved_total,
          (SELECT COUNT(*)::int FROM open_requests WHERE status IN ('SUBMITTED','VERIFYING')
             AND received_at <= now() - (${verifyParam}::int * interval '1 minute')) AS verification_overdue,
          (SELECT COUNT(*)::int FROM open_requests WHERE danger AND status IN ('SUBMITTED','VERIFYING')) AS declared_danger_waiting,
          (SELECT COUNT(*)::int FROM open_requests o WHERE o.status IN ('VERIFIED','TRIAGED')
             AND NOT EXISTS (SELECT 1 FROM mission m WHERE m.request_id = o.id AND m.status IN ${ACTIVE_MISSION})) AS awaiting_team_assignment`,
        [...rq.values, verifyOverdue]),
      this.dataSource.query(`
        SELECT COALESCE(jsonb_object_agg(status, c), '{}') AS active_by_status,
               COALESCE(SUM(c) FILTER (WHERE status = 'OFFERED' AND overdue), 0)::int AS overdue_offers
          FROM (SELECT m.status, COUNT(*)::int c,
                       (m.created_at <= now() - (${offerParam}::int * interval '1 minute')) AS overdue
                  FROM mission m JOIN assistance_request r ON r.id = m.request_id
                 WHERE m.status IN ${ACTIVE_MISSION} AND ${mq.where}
                 GROUP BY m.status, overdue) x`,
        [...mq.values, offerOverdue]),
      this.dataSource.query(`
        WITH teams AS (
          SELECT t.id, t.organization_id, t.availability, t.readiness_required
            FROM rescue_team t WHERE t.status = 'ACTIVE'
        ), scoped AS (SELECT * FROM teams t WHERE ${tq.where})
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE availability = 'AVAILABLE')::int AS available,
               COUNT(*) FILTER (WHERE availability <> 'AVAILABLE')::int AS unavailable,
               COUNT(*) FILTER (WHERE readiness_required AND availability <> 'AVAILABLE')::int AS awaiting_readiness,
               COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM mission m WHERE m.team_id = scoped.id AND m.status IN ${ACTIVE_MISSION}))::int AS on_mission,
               COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM team_position p WHERE p.team_id = scoped.id
                                                     AND p.captured_at >= now() - (${freshParam}::int * interval '1 minute')))::int AS position_missing_or_stale
          FROM scoped`,
        [...tq.values, positionFresh]),
      this.dataSource.query(`
        SELECT r.id, r.status, r.priority, r.incident_category_code AS category, r.received_at
          FROM assistance_request r
         WHERE ${cq.where} AND r.status NOT IN ${CLOSED}
         ORDER BY r.received_at DESC LIMIT 8`,
        cq.values),
    ]);

    const rqRow = requestRows[0] ?? {};
    const msRow = missionRows[0] ?? {};
    const tmRow = teamRows[0] ?? {};
    const openByStatus = toMap(rqRow.open_by_status);
    return {
      requests: {
        open_total: Object.values(openByStatus).reduce((a, b) => a + b, 0),
        open_by_status: openByStatus,
        open_by_priority: toMap(rqRow.open_by_priority),
        open_by_category: toMap(rqRow.open_by_category),
        received_last_24h: n(rqRow.received_24h),
        resolved_total: n(rqRow.resolved_total),
        verification_overdue: n(rqRow.verification_overdue),
        declared_danger_waiting: n(rqRow.declared_danger_waiting),
        awaiting_team_assignment: n(rqRow.awaiting_team_assignment),
      },
      missions: { active_by_status: toMap(msRow.active_by_status), overdue_offers: n(msRow.overdue_offers) },
      teams: {
        total: n(tmRow.total), available: n(tmRow.available), unavailable: n(tmRow.unavailable),
        awaiting_readiness: n(tmRow.awaiting_readiness), on_mission: n(tmRow.on_mission),
        position_missing_or_stale: n(tmRow.position_missing_or_stale),
      },
      thresholds: {
        verification_overdue_minutes: verifyOverdue,
        offer_overdue_minutes: offerOverdue,
        team_position_fresh_minutes: positionFresh,
      },
      recent_open_requests: (recentRows as Record<string, unknown>[]).map((row) => ({
        id: row.id, status: row.status, priority: row.priority ?? null,
        category: row.category, received_at: row.received_at,
      })),
      generated_at: new Date().toISOString(),
    };
  }
}
