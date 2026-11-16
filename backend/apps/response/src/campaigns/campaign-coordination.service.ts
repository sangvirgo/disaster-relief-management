import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { Grant } from '@c48/identity-contracts/permissions';
import { ReporterSession, ReporterSessionService } from '../requests/reporter-session';
import { openDangerStatuses, loadOperationsConfig } from '../operations/request-operations.helpers';

import { ENGAGEMENT_TTL_MINUTES } from '../requests/engagement-ttl';
import { CommonQueueQueryDto } from './campaigns.dto';
import { AreaCampaign, buildCommonQueueSuggestions, OPEN_REQUEST_STATUSES, OpenRequestPoint } from './campaign-area';
export { ENGAGEMENT_TTL_MINUTES };
export const MAX_ACTIVE_ENGAGEMENTS = 3;
const CLAIM_TTL_MINUTES = 15;
const openStatuses = "'SUBMITTED','VERIFYING','VERIFIED','TRIAGED','DISPATCHED','IN_PROGRESS','RESOLVING'";

type SqlRows<T> = T[] | [T[], number];
type EngagementRow = {
  id: string; campaign_id: string; user_id: string; started_at: Date | string; last_active_at: Date | string;
  ended_at: Date | string | null; ended_reason: string | null; campaign_name?: string; campaign_status?: string;
};
type HistoryRow = {
  id: string; occurred_at: Date | string; cursor_occurred_at: string; event_type: string; actor_user_id: string | null;
  request_id: string | null; mission_id: string | null; payload: Record<string, unknown> | null;
};

function rows<T>(value: SqlRows<T>): T[] {
  if (!Array.isArray(value)) return [];
  return Array.isArray(value[0]) ? value[0] as T[] : value as T[];
}

function primaryCoordinator(grants: readonly Grant[]): boolean {
  return grants.some((grant) => grant.role_code === 'COORDINATOR' && grant.scope_type === 'SYSTEM');
}

function campaignCoordinator(grants: readonly Grant[]): boolean {
  return grants.some((grant) => grant.role_code === 'CAMPAIGN_COORDINATOR' && grant.scope_type === 'SYSTEM');
}

function canViewTriage(grants: readonly Grant[]): boolean {
  return primaryCoordinator(grants) || campaignCoordinator(grants);
}

function urgencyReasons(item: {
  highest_priority: string | null; highest_priority_unhandled_count: number; overdue_count: number;
  longest_wait_seconds: number; active_coordinator_count: number;
}, overdueMinutes: number): string[] {
  const reasons: string[] = [];
  if (item.highest_priority && item.highest_priority_unhandled_count > 0) reasons.push(`${item.highest_priority}_UNHANDLED`);
  if (item.overdue_count > 0) reasons.push('OVERDUE');
  if (item.longest_wait_seconds >= overdueMinutes * 60) reasons.push('LONG_WAIT');
  if (item.active_coordinator_count === 0) reasons.push('NO_COORDINATOR');
  return reasons.length ? reasons : ['ROUTINE'];
}

function urgencyLabels(codes: string[]): string[] {
  const labels: Record<string, string> = {
    P1_UNHANDLED: 'Có hồ sơ P1 chưa được xử lý',
    P2_UNHANDLED: 'Có hồ sơ P2 chưa được xử lý',
    P3_UNHANDLED: 'Có hồ sơ P3 chưa được xử lý',
    P4_UNHANDLED: 'Có hồ sơ P4 chưa được xử lý',
    OVERDUE: 'Có hồ sơ quá hạn',
    LONG_WAIT: 'Có hồ sơ chờ lâu',
    NO_COORDINATOR: 'Chưa có điều phối viên tham gia',
    ROUTINE: 'Không có dấu hiệu gấp nổi bật',
  };
  return codes.map((code) => labels[code] ?? 'Cần theo dõi');
}

@Injectable()
export class CampaignCoordinationService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ReporterSessionService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async triage(request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    if (!canViewTriage(session.grants)) throw new AppError('FORBIDDEN', { status: 403 });
    const overdueMinutes = loadOperationsConfig().overdueMinutes;
    const result = rows(await this.dataSource.query(
      `WITH active AS (
         SELECT ce.campaign_id,count(*)::int AS coordinator_count
           FROM campaign_engagement ce
          WHERE ce.ended_at IS NULL AND ce.last_active_at > now()-interval '${ENGAGEMENT_TTL_MINUTES} minutes'
          GROUP BY ce.campaign_id
       ), eligible AS (
         SELECT r.campaign_id,r.priority,r.received_at,
                CASE r.priority WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 WHEN 'P4' THEN 4 END AS priority_rank
           FROM assistance_request r
          WHERE r.campaign_id IS NOT NULL AND r.canonical_request_id IS NULL AND r.status IN (${openStatuses})
            AND (r.handled_by IS NULL OR r.handled_at <= now()-interval '${CLAIM_TTL_MINUTES} minutes')
            AND NOT EXISTS (SELECT 1 FROM mission m WHERE m.request_id=r.id AND m.status IN ('OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE'))
       ), ranked AS (
         SELECT campaign_id,priority,priority_rank,dense_rank() OVER (PARTITION BY campaign_id ORDER BY priority_rank) AS rank
           FROM eligible WHERE priority_rank IS NOT NULL
      ), priority_counts AS (
         SELECT campaign_id,min(priority_rank) AS top_rank,count(*) FILTER (WHERE rank=1)::int AS top_count,
                count(*) FILTER (WHERE priority_rank=1)::int AS p1_count,
                count(*) FILTER (WHERE priority_rank=2)::int AS p2_count,
                count(*) FILTER (WHERE priority_rank=3)::int AS p3_count,
                count(*) FILTER (WHERE priority_rank=4)::int AS p4_count
           FROM ranked GROUP BY campaign_id
       ), request_counts AS (
         SELECT r.campaign_id,
                count(*) FILTER (WHERE r.status='SUBMITTED' AND r.received_at < now()-($1::int*interval '1 minute') OR
                    r.status='VERIFYING' AND r.verifying_since < now()-($1::int*interval '1 minute') OR
                    r.reporter_declared_danger AND r.status IN (${openDangerStatuses}))::int AS overdue_count,
                COALESCE(max(extract(epoch FROM now()-r.received_at)) FILTER (WHERE r.status IN (${openStatuses})),0)::int AS longest_wait_seconds
           FROM assistance_request r
          WHERE r.campaign_id IS NOT NULL AND r.canonical_request_id IS NULL
          GROUP BY r.campaign_id
       )
       SELECT c.id,c.name,c.status,COALESCE(pc.top_count,0)::int AS highest_priority_unhandled_count,
              CASE pc.top_rank WHEN 1 THEN 'P1' WHEN 2 THEN 'P2' WHEN 3 THEN 'P3' WHEN 4 THEN 'P4' END AS highest_priority,
              COALESCE(pc.p1_count,0)::int AS p1_count,COALESCE(pc.p2_count,0)::int AS p2_count,
              COALESCE(pc.p3_count,0)::int AS p3_count,COALESCE(pc.p4_count,0)::int AS p4_count,
              COALESCE(rc.overdue_count,0)::int AS overdue_count,COALESCE(rc.longest_wait_seconds,0)::int AS longest_wait_seconds,
              COALESCE(a.coordinator_count,0)::int AS active_coordinator_count
         FROM campaign c LEFT JOIN priority_counts pc ON pc.campaign_id=c.id
         LEFT JOIN request_counts rc ON rc.campaign_id=c.id LEFT JOIN active a ON a.campaign_id=c.id
        WHERE c.status='ACTIVE'`,
      [overdueMinutes],
    ) as Array<{
      id: string; name: string; status: string; highest_priority_unhandled_count: number; highest_priority: string | null;
      p1_count: number; p2_count: number; p3_count: number; p4_count: number;
      overdue_count: number; longest_wait_seconds: number; active_coordinator_count: number;
    }>);
    const items = result.map((item) => {
      const urgency = {
        highest_priority: item.highest_priority,
        highest_priority_unhandled_count: Number(item.highest_priority_unhandled_count),
        unhandled_priority_counts: { P1: Number(item.p1_count), P2: Number(item.p2_count), P3: Number(item.p3_count), P4: Number(item.p4_count) },
        overdue_count: Number(item.overdue_count),
        longest_wait_seconds: Number(item.longest_wait_seconds),
        active_coordinator_count: Number(item.active_coordinator_count),
        reason_codes: urgencyReasons(item, overdueMinutes),
      };
      const labels = urgencyLabels(urgency.reason_codes);
      return { ...item, urgency, urgency_reasons_vi: labels };
    }).sort((a, b) =>
      b.urgency.unhandled_priority_counts.P1 - a.urgency.unhandled_priority_counts.P1 ||
      b.urgency.unhandled_priority_counts.P2 - a.urgency.unhandled_priority_counts.P2 ||
      b.urgency.unhandled_priority_counts.P3 - a.urgency.unhandled_priority_counts.P3 ||
      b.urgency.unhandled_priority_counts.P4 - a.urgency.unhandled_priority_counts.P4 ||
      b.urgency.overdue_count - a.urgency.overdue_count ||
      b.urgency.longest_wait_seconds - a.urgency.longest_wait_seconds ||
      a.urgency.active_coordinator_count - b.urgency.active_coordinator_count || a.id.localeCompare(b.id));
    return { items };
  }

  async engage(campaignId: string, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    if (!canViewTriage(session.grants)) throw new AppError('FORBIDDEN', { status: 403 });
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.campaign-engagement:${session.userId}`,
      command: 'response.campaign.engage', key,
      requestHash: canonicalRequestHash({ actor_user_id: session.userId, campaign_id: campaignId }),
      execute: async (manager) => {
        await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [session.userId]);
        const campaigns = rows(await manager.query('SELECT id,status FROM campaign WHERE id=$1 FOR UPDATE', [campaignId]) as SqlRows<{ id: string; status: string }>);
        if (!campaigns[0]) throw new AppError('NOT_FOUND', { status: 404 });
        if (campaigns[0].status !== 'ACTIVE') throw new AppError('CAMPAIGN_NOT_ACTIVE', { status: 409 });
        await manager.query(
          `UPDATE campaign_engagement SET ended_at=now(),ended_reason='EXPIRED'
            WHERE user_id=$1 AND ended_at IS NULL AND last_active_at <= now()-interval '${ENGAGEMENT_TTL_MINUTES} minutes'`, [session.userId],
        );
        const existing = rows(await manager.query(
          `SELECT * FROM campaign_engagement WHERE campaign_id=$1 AND user_id=$2 AND ended_at IS NULL`, [campaignId, session.userId],
        ) as SqlRows<EngagementRow>);
        if (!existing.length) {
          const countRows = rows(await manager.query(
            `SELECT count(*)::int AS count FROM campaign_engagement
              WHERE user_id=$1 AND ended_at IS NULL AND last_active_at > now()-interval '${ENGAGEMENT_TTL_MINUTES} minutes'`, [session.userId],
          ) as SqlRows<{ count: number }>);
          if (Number(countRows[0]?.count ?? 0) >= MAX_ACTIVE_ENGAGEMENTS) {
            throw new AppError('ENGAGEMENT_LIMIT_REACHED', { status: 409, userMessage: 'Bạn chỉ có thể điều phối tối đa 3 chiến dịch cùng lúc.' });
          }
        }
        const inserted = rows(await manager.query(
          `INSERT INTO campaign_engagement (campaign_id,user_id,started_at,last_active_at)
           VALUES ($1,$2,now(),now())
           ON CONFLICT (campaign_id,user_id) WHERE ended_at IS NULL
           DO UPDATE SET last_active_at=now()
           RETURNING *`, [campaignId, session.userId],
        ) as SqlRows<EngagementRow>);
        const engagement = inserted[0];
        if (!engagement) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const value = this.engagementView(engagement);
        return { status: 201, value, resource: { type: 'campaign_engagement', id: engagement.id } };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'campaign_engagement') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const found = rows(await manager.query('SELECT * FROM campaign_engagement WHERE id=$1 AND user_id=$2', [resource.id, session.userId]) as SqlRows<EngagementRow>);
        if (!found[0]) throw new AppError('NOT_FOUND', { status: 404 });
        return this.engagementView(found[0]);
      },
    });
  }

  async disengage(campaignId: string, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    if (!canViewTriage(session.grants)) throw new AppError('FORBIDDEN', { status: 403 });
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.campaign-engagement:${session.userId}`,
      command: 'response.campaign.disengage', key,
      requestHash: canonicalRequestHash({ actor_user_id: session.userId, campaign_id: campaignId }),
      execute: async (manager) => {
        const changed = rows(await manager.query(
          `UPDATE campaign_engagement SET ended_at=now(),ended_reason=CASE
             WHEN last_active_at <= now()-interval '${ENGAGEMENT_TTL_MINUTES} minutes' THEN 'EXPIRED' ELSE 'LEFT' END
            WHERE campaign_id=$1 AND user_id=$2 AND ended_at IS NULL RETURNING *`, [campaignId, session.userId],
        ) as SqlRows<EngagementRow>);
        return { status: 200, value: changed[0] ? this.engagementView(changed[0]) : { campaign_id: campaignId, active: false },
          resource: changed[0] ? { type: 'campaign_engagement', id: changed[0].id } : { type: 'campaign', id: campaignId } };
      },
      replay: async (manager, resource) => {
        if (resource?.type === 'campaign_engagement') {
          const found = rows(await manager.query('SELECT * FROM campaign_engagement WHERE id=$1 AND user_id=$2', [resource.id, session.userId]) as SqlRows<EngagementRow>);
          return found[0] ? this.engagementView(found[0]) : { campaign_id: campaignId, active: false };
        }
        return { campaign_id: campaignId, active: false };
      },
    });
  }

  async myEngagements(request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    if (!canViewTriage(session.grants)) throw new AppError('FORBIDDEN', { status: 403 });
    const found = rows(await this.dataSource.query(
      `SELECT ce.*,c.name AS campaign_name,c.status AS campaign_status
         FROM campaign_engagement ce JOIN campaign c ON c.id=ce.campaign_id
        WHERE ce.user_id=$1 AND ce.ended_at IS NULL AND ce.last_active_at > now()-interval '${ENGAGEMENT_TTL_MINUTES} minutes'
        ORDER BY ce.started_at DESC,ce.id DESC`, [session.userId],
    ) as SqlRows<EngagementRow>);
    return { items: found.map((item) => this.engagementView(item)) };
  }

  /**
   * Control view for the primary coordinator. `requests` is one keyset page of SOS that still need a campaign decision;
   * `map_points` (all, capped) and `clusters` cover the whole set so the map stays complete.
   */
  async commonQueueSuggestions(query: CommonQueueQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    if (!primaryCoordinator(session.grants)) throw new AppError('FORBIDDEN', { status: 403 });
    const filters = { route: 'response.campaign-common-queue', match_state: query.match_state ?? null };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : null;
    if (cursor) {
      const when = typeof cursor.sort[0] === 'string' ? new Date(cursor.sort[0]) : null;
      if (cursor.sort.length !== 2 || !when || Number.isNaN(when.getTime()) || when.toISOString() !== cursor.sort[0] || cursor.sort[1] !== cursor.id) {
        throw new AppError('CURSOR_INVALID', { status: 400 });
      }
    }
    const limit = query.limit ?? 10;
    const baseWhere = `r.campaign_id IS NULL AND r.campaign_match_state IN ('UNMATCHED','CONFLICT')
          AND r.canonical_request_id IS NULL AND r.status IN (${OPEN_REQUEST_STATUSES})`;
    const lat = "round(ST_Y(s.location::geometry)::numeric,3)::float8";
    const lng = "round(ST_X(s.location::geometry)::numeric,3)::float8";
    const toPoint = (item: Record<string, unknown>): OpenRequestPoint => ({
      id: String(item.id), tracking_code: String(item.tracking_code), priority: item.priority == null ? null : String(item.priority),
      status: String(item.status), version: Number(item.version), campaign_match_state: String(item.campaign_match_state),
      latitude: Number(item.latitude), longitude: Number(item.longitude),
    });
    const all = rows(await this.dataSource.query(
      `SELECT r.id,r.tracking_code,r.priority,r.status,r.version,r.campaign_match_state,${lat} AS latitude,${lng} AS longitude
         FROM assistance_request r JOIN request_subject s ON s.request_id=r.id
        WHERE ${baseWhere} ORDER BY r.received_at,r.id LIMIT 500`,
    ) as SqlRows<Record<string, unknown>>).map(toPoint);
    const campaigns = rows(await this.dataSource.query(
      `SELECT id,name,status,version,radius_m,ST_Y(center::geometry) AS latitude,ST_X(center::geometry) AS longitude
         FROM campaign WHERE status IN ('DRAFT','ACTIVE','PAUSED') AND center IS NOT NULL AND radius_m IS NOT NULL`,
    ) as SqlRows<Record<string, unknown>>).map((item): AreaCampaign => ({
      id: String(item.id), name: String(item.name), status: String(item.status), version: Number(item.version), radius_m: Number(item.radius_m),
      latitude: Number(item.latitude), longitude: Number(item.longitude),
    }));
    const built = buildCommonQueueSuggestions(all, campaigns) as {
      requests: Array<{ id: string; tracking_code: string; priority: string | null; campaign_match_state: string; location: unknown }>;
    } & Record<string, unknown>;

    const values: unknown[] = [];
    const conditions = [baseWhere];
    if (query.match_state) { values.push(query.match_state); conditions.push(`r.campaign_match_state=$${values.length}`); }
    const countRows = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM assistance_request r WHERE ${conditions.join(' AND ')}`, values,
    ) as Array<{ total: number }>;
    if (cursor) {
      values.push(cursor.sort[0], cursor.id);
      conditions.push(`(date_trunc('milliseconds',r.received_at),r.id)>($${values.length - 1}::timestamptz,$${values.length}::uuid)`);
    }
    values.push(limit + 1);
    const pageRows = rows(await this.dataSource.query(
      `SELECT r.id,r.tracking_code,r.priority,r.status,r.version,r.campaign_match_state,r.campaign_candidate_ids,
              date_trunc('milliseconds',r.received_at) AS received_at,
              ${lat} AS latitude,${lng} AS longitude
         FROM assistance_request r JOIN request_subject s ON s.request_id=r.id
        WHERE ${conditions.join(' AND ')} ORDER BY date_trunc('milliseconds',r.received_at),r.id LIMIT $${values.length}`, values,
    ) as SqlRows<Record<string, unknown>>);
    const page = pageRows.slice(0, limit);
    const pageIds = new Set(page.map((item) => String(item.id)));
    const decorated = new Map(buildCommonQueueSuggestions(page.map(toPoint), campaigns).requests.map((item) => [item.id, item]));
    const last = page.at(-1);
    return {
      requests: page.map((item) => ({
        ...decorated.get(String(item.id)),
        candidate_campaign_ids: (item.campaign_candidate_ids as string[] | null) ?? [],
        received_at: new Date(item.received_at as Date | string).toISOString(),
      })),
      total: Number(countRows[0]?.total ?? 0),
      more: pageRows.length > limit,
      ...(pageRows.length > limit && last
        ? { cursor: encodeKeysetCursor([new Date(last.received_at as Date | string).toISOString(), String(last.id)], String(last.id), filters) }
        : {}),
      map_points: built.requests.map((item) => ({
        id: item.id, tracking_code: item.tracking_code, priority: item.priority,
        campaign_match_state: item.campaign_match_state, location: item.location, on_page: pageIds.has(item.id),
      })),
      clusters: built.clusters,
      campaigns: built.campaigns,
      attach_targets: await this.dataSource.query(
        "SELECT id,name FROM campaign WHERE status='ACTIVE' ORDER BY name,id",
      ) as Array<{ id: string; name: string }>,
    };
  }

  async overview(request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    if (!primaryCoordinator(session.grants)) throw new AppError('FORBIDDEN', { status: 403 });
    const overdueMinutes = loadOperationsConfig().overdueMinutes;
    const campaignRows = rows(await this.dataSource.query(
      `SELECT c.id,c.name,c.status,c.version,
              CASE WHEN c.center IS NULL THEN NULL ELSE ST_Y(c.center::geometry) END AS center_latitude,
              CASE WHEN c.center IS NULL THEN NULL ELSE ST_X(c.center::geometry) END AS center_longitude,c.radius_m,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id',ce.user_id,'started_at',ce.started_at,'last_active_at',ce.last_active_at)
                  ORDER BY ce.started_at,ce.user_id) FROM campaign_engagement ce WHERE ce.campaign_id=c.id AND ce.ended_at IS NULL AND ce.last_active_at>now()-interval '${ENGAGEMENT_TTL_MINUTES} minutes'),'[]'::jsonb) AS active_coordinators,
              COALESCE((SELECT jsonb_object_agg(counts.status,counts.total) FROM
                (SELECT r.status,count(*)::int AS total FROM assistance_request r WHERE r.campaign_id=c.id AND r.canonical_request_id IS NULL GROUP BY r.status) counts),'{}'::jsonb) AS request_counts,
              (SELECT count(*)::int FROM assistance_request r WHERE r.campaign_id=c.id AND r.handled_by IS NOT NULL
                 AND r.handled_at>now()-interval '${CLAIM_TTL_MINUTES} minutes') AS active_claim_count,
              (SELECT count(*)::int FROM assistance_request r WHERE r.campaign_id=c.id AND r.canonical_request_id IS NULL AND
                ((r.status='SUBMITTED' AND r.received_at<now()-($1::int*interval '1 minute')) OR
                 (r.status='VERIFYING' AND r.verifying_since<now()-($1::int*interval '1 minute')) OR
                 (r.reporter_declared_danger AND r.status IN (${openDangerStatuses})))) AS overdue_count
         FROM campaign c ORDER BY c.created_at DESC,c.id`, [overdueMinutes],
    ) as SqlRows<Record<string, unknown>>);
    const items = campaignRows.map((row) => {
      const coordinators = (row.active_coordinators ?? []) as Array<Record<string, unknown>>;
      return {
        id: row.id, name: row.name, status: row.status, center: row.center_latitude == null ? null : { lat: Number(row.center_latitude), lng: Number(row.center_longitude) },
        radius_m: row.radius_m == null ? null : Number(row.radius_m), active_coordinators: coordinators,
        request_counts: row.request_counts, active_claim_count: Number(row.active_claim_count), overdue_count: Number(row.overdue_count),
        has_active_coordinator: coordinators.length > 0,
      };
    });
    const names = await this.sessions.lookupUsers(items.flatMap((item) => item.active_coordinators.map((person) => String(person.user_id))));
    const nameMap = new Map(names.map((item) => [item.id, item.display_name]));
    for (const item of items) item.active_coordinators = item.active_coordinators.map((person) => ({ ...person, display_name: nameMap.get(String(person.user_id)) ?? null }));
    const queueRows = rows(await this.dataSource.query(
      `SELECT campaign_match_state,count(*)::int AS total FROM assistance_request
        WHERE campaign_id IS NULL AND campaign_match_state IN ('UNMATCHED','CONFLICT') GROUP BY campaign_match_state`,
    ) as SqlRows<{ campaign_match_state: string; total: number }>);
    const totals = Object.fromEntries(queueRows.map((item) => [item.campaign_match_state, Number(item.total)]));
    return { items, common_queue: { unmatched: totals.UNMATCHED ?? 0, conflict: totals.CONFLICT ?? 0 } };
  }

  async history(campaignId: string, cursorValue: string | undefined, limitValue: number | undefined, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    await this.assertCampaignHistoryAccess(campaignId, session);
    const limit = limitValue ?? 50;
    const filters = { campaign_id: campaignId, user_id: session.userId };
    const cursor = cursorValue ? decodeKeysetCursor(cursorValue, filters) : undefined;
    const rowsFound = rows(await this.dataSource.query(
      `WITH timeline AS (
         SELECT md5(ce.id::text||':STARTED')::uuid AS id,ce.started_at AS occurred_at,'COORDINATION_STARTED'::text AS event_type,
                ce.user_id AS actor_user_id,NULL::uuid AS request_id,NULL::uuid AS mission_id,jsonb_build_object('engagement_id',ce.id) AS payload
           FROM campaign_engagement ce WHERE ce.campaign_id=$1
         UNION ALL
         SELECT md5(ce.id::text||':'||COALESCE(ce.ended_reason,'EXPIRED'))::uuid,
                COALESCE(ce.ended_at,ce.last_active_at+interval '${ENGAGEMENT_TTL_MINUTES} minutes'),
                CASE WHEN ce.ended_reason='LEFT' THEN 'COORDINATION_LEFT' WHEN ce.ended_reason IS NULL OR ce.ended_reason='EXPIRED' THEN 'COORDINATION_EXPIRED'
                  WHEN ce.ended_reason='SWITCHED' THEN 'COORDINATION_SWITCHED' ELSE 'COORDINATION_CAMPAIGN_CLOSED' END,
                ce.user_id,NULL::uuid,NULL::uuid,jsonb_build_object('engagement_id',ce.id,'ended_reason',ce.ended_reason)
           FROM campaign_engagement ce WHERE ce.campaign_id=$1 AND (ce.ended_at IS NOT NULL OR ce.last_active_at <= now()-interval '${ENGAGEMENT_TTL_MINUTES} minutes')
         UNION ALL
         SELECT e.id,e.occurred_at,e.event_type,e.actor_user_id,r.id,NULL::uuid,e.payload
           FROM request_event e JOIN assistance_request r ON r.id=e.request_id
          WHERE COALESCE(NULLIF(e.payload->>'campaign_id','')::uuid,NULLIF(e.payload->>'previous_campaign_id','')::uuid,r.campaign_id)=$1
             OR (e.payload ? 'campaign_candidate_ids' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(e.payload->'campaign_candidate_ids') v WHERE v.value=$1::text))
         UNION ALL
         SELECT me.id,me.occurred_at,'MISSION_'||me.to_status,me.actor_user_id,m.request_id,m.id,
                jsonb_build_object('from_status',me.from_status,'to_status',me.to_status,'reason',me.reason,'outcome_note',me.outcome_note)
           FROM mission_event me JOIN mission m ON m.id=me.mission_id JOIN assistance_request r ON r.id=m.request_id
          WHERE r.campaign_id=$1
       )
       SELECT id,occurred_at,event_type,actor_user_id,request_id,mission_id,payload,
              to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_occurred_at
         FROM timeline
        WHERE ($2::timestamptz IS NULL OR (occurred_at,id)<($2::timestamptz,$3::uuid))
        ORDER BY occurred_at DESC,id DESC LIMIT $4`,
      [campaignId, cursor?.sort[0] ?? null, cursor?.id ?? null, limit + 1],
    ) as SqlRows<HistoryRow>);
    const more = rowsFound.length > limit;
    const page = rowsFound.slice(0, limit);
    const next = more ? page.at(-1) : undefined;
    const actorNames = await this.sessions.lookupUsers([...new Set(page.flatMap((item) => item.actor_user_id ? [item.actor_user_id] : []))]);
    const nameMap = new Map(actorNames.map((item) => [item.id, item.display_name]));
    const requestIds = [...new Set(page.flatMap((item) => item.request_id ? [item.request_id] : []))];
    const codeRows = requestIds.length
      ? rows(await this.dataSource.query('SELECT id,tracking_code FROM assistance_request WHERE id=ANY($1::uuid[])', [requestIds]) as SqlRows<{ id: string; tracking_code: string }>)
      : [];
    const codeMap = new Map(codeRows.map((item) => [item.id, item.tracking_code]));
    return {
      items: page.map((item) => ({
        tracking_code: item.request_id ? codeMap.get(item.request_id) ?? null : null,
        occurred_at: new Date(item.occurred_at).toISOString(), event_type: item.event_type,
        actor: item.actor_user_id ? { id: item.actor_user_id, display_name: nameMap.get(item.actor_user_id) ?? null } : null,
        request_id: item.request_id, mission_id: item.mission_id, payload: item.payload,
      })),
      more,
      ...(next ? { cursor: encodeKeysetCursor([next.cursor_occurred_at], next.id, filters) } : {}),
    };
  }

  async historySummary(campaignId: string, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    await this.assertCampaignHistoryAccess(campaignId, session);
    const result = rows(await this.dataSource.query(
      `WITH requests AS (
         SELECT * FROM assistance_request WHERE campaign_id=$1 AND canonical_request_id IS NULL
       ), durations AS (
         SELECT ce.user_id,COALESCE(ce.ended_at,LEAST(now(),ce.last_active_at+interval '${ENGAGEMENT_TTL_MINUTES} minutes'))-ce.started_at AS duration
           FROM campaign_engagement ce WHERE ce.campaign_id=$1
       ), response_times AS (
         SELECT DISTINCT ON (m.id) extract(epoch FROM me.occurred_at-r.received_at)::double precision AS seconds
           FROM mission m JOIN assistance_request r ON r.id=m.request_id
           JOIN mission_event me ON me.mission_id=m.id AND me.to_status='ACCEPTED'
          WHERE r.campaign_id=$1 ORDER BY m.id,me.occurred_at,me.id
       )
       SELECT count(*) FILTER (WHERE status IN ('RESOLVED','CLOSED'))::int AS completed_requests,
              count(*) FILTER (WHERE status IN ('CANCELLED','REJECTED','DUPLICATE'))::int AS cancelled_requests,
              count(*) FILTER (WHERE status NOT IN ('RESOLVED','CLOSED','CANCELLED','REJECTED','DUPLICATE'))::int AS open_requests,
              (SELECT count(*)::int FROM mission m JOIN requests r ON r.id=m.request_id
                WHERE m.status='COMPLETED') AS completed_missions,
              (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds) FROM response_times) AS median_response_seconds,
              (SELECT COALESCE(jsonb_agg(jsonb_build_object('user_id',agg.user_id,'total_seconds',agg.total_seconds)
                   ORDER BY agg.total_seconds DESC,agg.user_id),'[]'::jsonb) FROM (
                 SELECT d.user_id,sum(extract(epoch FROM d.duration))::bigint AS total_seconds
                   FROM durations d GROUP BY d.user_id
               ) agg) AS coordinators
         FROM requests`, [campaignId],
    ) as SqlRows<Record<string, unknown>>);
    const summary = result[0] ?? {};
    const people = (summary.coordinators ?? []) as Array<Record<string, unknown>>;
    const profiles = await this.sessions.lookupUsers(people.map((person) => String(person.user_id)));
    const profileMap = new Map(profiles.map((profile) => [profile.id, profile.display_name]));
    return {
      completed_requests: Number(summary.completed_requests ?? 0), cancelled_requests: Number(summary.cancelled_requests ?? 0),
      open_requests: Number(summary.open_requests ?? 0), completed_missions: Number(summary.completed_missions ?? 0),
      median_response_seconds: summary.median_response_seconds == null ? null : Number(summary.median_response_seconds),
      coordinators: people.map((person) => ({ user_id: person.user_id, display_name: profileMap.get(String(person.user_id)) ?? null,
        total_seconds: Number(person.total_seconds) })),
    };
  }

  async myHistory(request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    if (!canViewTriage(session.grants)) throw new AppError('FORBIDDEN', { status: 403 });
    const found = rows(await this.dataSource.query(
      `SELECT ce.*,c.name AS campaign_name,c.status AS campaign_status FROM campaign_engagement ce JOIN campaign c ON c.id=ce.campaign_id
        WHERE ce.user_id=$1 ORDER BY ce.started_at DESC,ce.id DESC LIMIT 500`, [session.userId],
    ) as SqlRows<EngagementRow>);
    return { items: found.map((item) => ({ ...this.engagementView(item), duration_seconds:
      Math.max(0, Math.floor((new Date(item.ended_at ?? new Date(Math.min(Date.now(), new Date(item.last_active_at).getTime() + ENGAGEMENT_TTL_MINUTES * 60_000))).getTime() - new Date(item.started_at).getTime()) / 1000)) })) };
  }

  private async assertCampaignHistoryAccess(campaignId: string, session: ReporterSession): Promise<void> {
    const campaign = rows(await this.dataSource.query('SELECT 1 FROM campaign WHERE id=$1', [campaignId]) as SqlRows<{ '?column?': number }>);
    if (!campaign.length) throw new AppError('NOT_FOUND', { status: 404 });
    if (primaryCoordinator(session.grants)) return;
    if (!campaignCoordinator(session.grants)) throw new AppError('FORBIDDEN', { status: 403 });
    const rowsFound = rows(await this.dataSource.query(
      'SELECT 1 FROM campaign_engagement WHERE campaign_id=$1 AND user_id=$2 LIMIT 1', [campaignId, session.userId],
    ) as SqlRows<{ '?column?': number }>);
    if (!rowsFound.length) throw new AppError('FORBIDDEN', { status: 403 });
  }

  private engagementView(row: EngagementRow): Record<string, unknown> {
    return {
      id: row.id, campaign_id: row.campaign_id, campaign_name: row.campaign_name ?? null, campaign_status: row.campaign_status ?? null,
      user_id: row.user_id, started_at: new Date(row.started_at).toISOString(), last_active_at: new Date(row.last_active_at).toISOString(),
      ended_at: row.ended_at ? new Date(row.ended_at).toISOString() : null, ended_reason: row.ended_reason,
      active: row.ended_at == null && new Date(row.last_active_at).getTime() > Date.now() - ENGAGEMENT_TTL_MINUTES * 60_000,
    };
  }
}
