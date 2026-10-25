import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../../packages/technical/src/pagination/keyset';
import { hasPermission } from '../../../../packages/technical/src/security/permissions';
import { ReporterSessionService } from '../requests/reporter-session';
import type { ReporterSession } from '../requests/reporter-session';
import type { RequestOperationPageDto, RequestQueueQueryDto } from './request-operations.dto';
import { REQUEST_OPERATIONS_CONFIG } from './request-operations.config';
import { asObject, filtersHash, openDangerStatuses, parseBbox, relatedRequestIds, restrictEventPayload, scopeSql, toIso } from './request-operations.helpers';
import type { OperationRequestRow, QueueRow, RequestEventRow, RequestOperationsConfig } from './request-operations.types';
import { decisionView, eventView } from './request-operations.mapper';
import { RequestOperationsPersistenceService } from './request-operations.persistence.service';

@Injectable()
export class RequestOperationsQueriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ReporterSessionService,
    @Inject(REQUEST_OPERATIONS_CONFIG) private readonly config: RequestOperationsConfig,
    private readonly persistence: RequestOperationsPersistenceService,
  ) {}

  async queue(query: RequestQueueQueryDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const limit = query.limit ?? 50;
    const filters = filtersHash(session.grants, session.userId, query, 'requests');
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : undefined;
    const values: unknown[] = [];
    const scope = scopeSql(session.grants, 'REQUEST_QUEUE_READ', values);
    const conditions = [scope];
    const add = (clause: (index: number) => string, value: unknown) => { values.push(value); conditions.push(clause(values.length)); };
    if (!(query.overdue === 'true' && query.review_lane === undefined)) add((index) => `r.review_lane=$${index}`, query.review_lane ?? 'NORMAL');
    if (query.status) add((index) => `r.status=$${index}`, query.status);
    if (query.region_code) add((index) => `r.region_code=$${index}`, query.region_code);
    if (query.priority) add((index) => `r.priority=$${index}`, query.priority);
    if (query.category) add((index) => `r.incident_category_code=$${index}`, query.category);
    if (query.from) add((index) => `r.received_at >= $${index}::timestamptz`, query.from);
    if (query.to) add((index) => `r.received_at <= $${index}::timestamptz`, query.to);
    if (query.declared_danger) add((index) => `r.reporter_declared_danger=$${index}`, query.declared_danger === 'true');
    const bbox = parseBbox(query.bbox);
    if (bbox) {
      values.push(...bbox);
      conditions.push(`ST_Intersects(s.location,ST_MakeEnvelope($${values.length - 3},$${values.length - 2},$${values.length - 1},$${values.length},4326)::geography)`);
    }
    const overdue = `((r.status='SUBMITTED' AND r.received_at < clock_timestamp()-($${values.length + 1} * interval '1 minute')) OR (r.status='VERIFYING' AND r.verifying_since < clock_timestamp()-($${values.length + 1} * interval '1 minute')) OR (r.reporter_declared_danger AND r.status IN (${openDangerStatuses})))`;
    values.push(this.config.overdueMinutes);
    if (query.overdue === 'true') conditions.push(overdue);
    if (query.overdue === 'false') conditions.push(`NOT ${overdue}`);
    values.push(cursor?.sort[0] ?? null, cursor?.id ?? null);
    conditions.push(`($${values.length - 1}::timestamptz IS NULL OR (r.received_at,r.id)>($${values.length - 1}::timestamptz,$${values.length}::uuid))`);
    values.push(limit + 1);
    const rows = await this.dataSource.query(
      `SELECT r.id,r.tracking_code,r.status,r.priority,r.review_lane,r.incident_category_code AS category,
              s.people_affected,r.region_code,r.received_at,
              to_char(r.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_received_at,
              r.reporter_declared_danger AS declared_danger,${overdue} AS overdue,
              CASE WHEN r.reporter_contact_phone IS NULL THEN NULL ELSE '******'||right(r.reporter_contact_phone,4) END AS reporter_contact_phone,
              round(ST_X(s.location::geometry)::numeric,3)::float8 AS longitude,
              round(ST_Y(s.location::geometry)::numeric,3)::float8 AS latitude,
              coalesce((SELECT e.payload->'flags' FROM request_event e WHERE e.request_id=r.id AND e.event_type='PROXY_ACTIVITY_FLAG' ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1),'[]'::jsonb) AS proxy_activity_flags
         FROM assistance_request r JOIN request_subject s ON s.request_id=r.id
        WHERE ${conditions.join(' AND ')}
        ORDER BY r.received_at ASC,r.id ASC LIMIT $${values.length}`,
      values,
    ) as QueueRow[];
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const items = page.map((row) => ({
      id: row.id, tracking_code: row.tracking_code, status: row.status, priority: row.priority,
      review_lane: row.review_lane, category: row.category, people_affected: row.people_affected,
      region_code: row.region_code, received_at: toIso(row.received_at), declared_danger: row.declared_danger,
      overdue: row.overdue, reporter_contact_phone: row.reporter_contact_phone,
      approx_location: { longitude: Number(row.longitude), latitude: Number(row.latitude) },
      staff_flags: row.proxy_activity_flags ?? [],
    }));
    const next = more && page.length ? page[page.length - 1]! : undefined;
    return {
      items, more,
      ...(next ? { cursor: encodeKeysetCursor([next.cursor_received_at], next.id, filters) } : {}),
      generated_at: new Date().toISOString(),
    };
  }

  async unassigned(query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const filters = filtersHash(session.grants, session.userId, query, 'unassigned');
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : undefined;
    const values: unknown[] = [];
    const scope = scopeSql(session.grants, 'REQUEST_UNASSIGNED_QUEUE', values, 'r', true);
    values.push(cursor?.sort[0] ?? null, cursor?.id ?? null, (query.limit ?? 50) + 1);
    const rows = await this.dataSource.query(
      `SELECT r.id,r.tracking_code,r.status,r.review_lane,r.incident_category_code AS category,
              s.people_affected,r.received_at,to_char(r.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_received_at
         FROM assistance_request r JOIN request_subject s ON s.request_id=r.id
        WHERE ${scope} AND r.region_code IS NULL AND r.status NOT IN ('REJECTED','DUPLICATE','CANCELLED','CLOSED')
          AND ($${values.length - 2}::timestamptz IS NULL OR (r.received_at,r.id)>($${values.length - 2}::timestamptz,$${values.length - 1}::uuid))
        ORDER BY r.received_at,r.id LIMIT $${values.length}`,
      values,
    ) as Array<QueueRow>;
    const limit = query.limit ?? 50;
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const next = more && page.length ? page[page.length - 1]! : undefined;
    return {
      items: page.map((row) => ({ id: row.id, tracking_code: row.tracking_code, status: row.status, review_lane: row.review_lane, category: row.category, people_affected: row.people_affected, received_at: toIso(row.received_at) })),
      more, ...(next ? { cursor: encodeKeysetCursor([next.cursor_received_at], next.id, filters) } : {}),
    };
  }

  async detail(requestId: string, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const row = await this.persistence.staffRequest(this.dataSource, requestId, session, 'REQUEST_DETAIL_READ');
    const [subjectRows, eventPage, attempts, decisionRows, missionRows, missionHistory, evidenceRows, canonicalRows, duplicateRows, advisoryRows] = await Promise.all([
      this.dataSource.query(
        `SELECT people_affected,children_count,elderly_count,location_source,location_accuracy_m,location_captured_at,
                ST_X(location::geometry) AS longitude,ST_Y(location::geometry) AS latitude,
                reporter_relationship,beneficiary_contact_phone,alternate_contact_name,alternate_contact_phone,
                information_source,last_known_situation_at,contactability,household_reference_note
           FROM request_subject WHERE request_id=$1`, [row.id],
      ) as Promise<Array<Record<string, unknown>>>,
      this.staffEvents(this.dataSource, row.id, undefined, 50, session),
      this.contactAttemptsPage(this.dataSource, row.id, undefined, 20),
      this.dataSource.query(
        `SELECT outcome,basis,reviewer_user_id,concurring_user_id,reason,reason_kind,decided_at
           FROM verification_decision WHERE request_id=$1 ORDER BY decided_at DESC,id DESC LIMIT 1`, [row.id],
      ) as Promise<Array<Record<string, unknown>>>,
      this.dataSource.query(
        `SELECT id,status,mission_kind,created_at,team_id FROM mission WHERE request_id=$1 AND status IN ('OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE') ORDER BY created_at,id LIMIT 6`, [row.id],
      ) as Promise<Array<Record<string, unknown>>>,
      this.dataSource.query(
        `SELECT m.id,m.status,m.mission_kind,m.created_at,m.team_id,t.name AS team_name,m.suggested_team_id,m.override_reason,
                e.to_status AS last_status,e.occurred_at AS last_occurred_at,e.recorded_basis,e.reported_by
           FROM mission m JOIN rescue_team t ON t.id=m.team_id
           LEFT JOIN LATERAL (SELECT to_status,occurred_at,recorded_basis,reported_by FROM mission_event WHERE mission_id=m.id ORDER BY occurred_at DESC,id DESC LIMIT 1) e ON true
          WHERE m.request_id=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT 21`, [row.id],
      ) as Promise<Array<Record<string, unknown>>>,
      this.dataSource.query(
        `SELECT id,state,size_bytes,detected_mime,checksum,created_at FROM evidence_metadata WHERE request_id=$1 AND state='READY' ORDER BY created_at DESC,id DESC LIMIT 6`, [row.id],
      ) as Promise<Array<Record<string, unknown>>>,
      row.canonical_request_id ? this.scopedRequestSummary(row.canonical_request_id, session) : Promise.resolve([]),
      this.duplicatesPage(this.dataSource, row.id, undefined, 20, session),
      this.dataSource.query(
        `SELECT id,model,status,risk_score,reason_codes,extracted_json,review_status,review_by_user_id,review_at,review_note,error_code,created_at
           FROM ai_advisory WHERE request_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [row.id],
      ) as Promise<Array<Record<string, unknown>>>,
    ]);
    const subject = subjectRows[0];
    if (!subject) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const safeEvents = await this.restrictEvents(eventPage.items, session);
    const flagViews = safeEvents.filter((event) => event.event_type === 'PROXY_ACTIVITY_FLAG').map((event) => ({
      event_id: event.id, occurred_at: event.occurred_at,
      flags: Array.isArray(asObject(event.payload).flags) ? asObject(event.payload).flags : [],
      distinct_locations_approx_100m: asObject(event.payload).distinct_locations_approx_100m ?? 0,
      rejected_count: asObject(event.payload).rejected_count ?? 0,
      recent_request_ids: asObject(event.payload).recent_request_ids ?? [],
      rejected_request_ids: asObject(event.payload).rejected_request_ids ?? [],
    }));
    return {
      id: row.id, tracking_code: row.tracking_code, report_mode: row.report_mode,
      status: row.status, version: Number(row.version), work_cycle: Number(row.work_cycle),
      priority: row.priority, priority_basis: row.priority_basis, review_lane: row.review_lane,
      category: row.incident_category_code, description: row.description,
      region_code: row.region_code, campaign_id: row.campaign_id, received_at: toIso(row.received_at),
      declared_danger: row.reporter_declared_danger,
      needs_rescue: row.needs_rescue, needs_relief_supplies: row.needs_relief_supplies,
      reporter: { user_id: row.reporter_user_id, name: row.reporter_name, contact_phone: row.reporter_contact_phone },
      subject: {
        people_affected: subject.people_affected,
        children_count: subject.children_count, elderly_count: subject.elderly_count,
        location: { type: 'Point', coordinates: [Number(subject.longitude), Number(subject.latitude)], source: subject.location_source, accuracy_m: subject.location_accuracy_m, captured_at: subject.location_captured_at == null ? null : toIso(subject.location_captured_at as Date | string) },
        reporter_relationship: subject.reporter_relationship, beneficiary_contact_phone: subject.beneficiary_contact_phone,
        alternate_contact: { name: subject.alternate_contact_name, phone: subject.alternate_contact_phone },
        information_source: subject.information_source,
        last_known_situation_at: subject.last_known_situation_at == null ? null : toIso(subject.last_known_situation_at as Date | string),
        contactability: subject.contactability, household_reference_note: subject.household_reference_note,
      },
      proxy_activity_flags: flagViews,
      timeline: { items: safeEvents.map((event) => eventView(event)), more: eventPage.more },
      contact_attempts: { items: attempts.items, more: attempts.more },
      verification_decision: decisionRows[0] ? decisionView(decisionRows[0]) : null,
      active_missions: { items: missionRows.slice(0, 5).map((mission) => ({ ...mission, created_at: toIso(mission.created_at as Date | string) })), more: missionRows.length > 5 },
      mission_history: { items: missionHistory.slice(0, 20).map((mission) => ({ ...mission, created_at: toIso(mission.created_at as Date | string), last_occurred_at: mission.last_occurred_at == null ? null : toIso(mission.last_occurred_at as Date | string) })), more: missionHistory.length > 20 },
      ai_advisory: advisoryRows[0] ? {
        ...advisoryRows[0], created_at: toIso(advisoryRows[0].created_at as Date | string),
        review_at: advisoryRows[0].review_at == null ? null : toIso(advisoryRows[0].review_at as Date | string),
        human_review_required: true,
      } : null,
      evidence: { items: evidenceRows.slice(0, 5).map((evidence) => ({ ...evidence, created_at: toIso(evidence.created_at as Date | string) })), more: evidenceRows.length > 5 },
      canonical: canonicalRows[0] ?? null,
      duplicates: { items: duplicateRows.items, more: duplicateRows.more },
    };
  }

  async events(requestId: string, query: RequestOperationPageDto, request: Request, sessionOverride?: ReporterSession): Promise<Record<string, unknown>> {
    const session = sessionOverride ?? await this.sessions.require(request);
    await this.persistence.staffRequest(this.dataSource, requestId, session, 'REQUEST_DETAIL_READ');
    const page = await this.staffEvents(this.dataSource, requestId, query.cursor, query.limit ?? 50, session);
    const items = await this.restrictEvents(page.items, session);
    return { items: items.map((event) => eventView(event)), more: page.more, ...(page.cursor ? { cursor: page.cursor } : {}) };
  }

  async contactAttempts(requestId: string, query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    await this.persistence.staffRequest(this.dataSource, requestId, session, 'REQUEST_DETAIL_READ');
    return this.contactAttemptsPage(this.dataSource, requestId, query.cursor, query.limit ?? 50);
  }

  async duplicates(requestId: string, query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    await this.persistence.staffRequest(this.dataSource, requestId, session, 'REQUEST_DETAIL_READ');
    return this.duplicatesPage(this.dataSource, requestId, query.cursor, query.limit ?? 50, session);
  }

  async evidence(requestId: string, query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    await this.persistence.staffRequest(this.dataSource, requestId, session, 'REQUEST_DETAIL_READ');
    const filters = { request_id: requestId, state: 'READY' };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : undefined;
    const limit = query.limit ?? 50;
    const rows = await this.dataSource.query(
      `SELECT id,state,size_bytes,detected_mime,checksum,created_at,
              to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
         FROM evidence_metadata WHERE request_id=$1 AND state='READY'
          AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid))
        ORDER BY created_at DESC,id DESC LIMIT $4`,
      [requestId, cursor?.sort[0] ?? null, cursor?.id ?? null, limit + 1],
    ) as Array<Record<string, unknown> & { id: string; created_at: Date | string; cursor_created_at: string }>;
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const next = more ? page.at(-1) : undefined;
    return {
      items: page.map((row) => ({ id: row.id, state: row.state, size_bytes: Number(row.size_bytes), detected_mime: row.detected_mime, checksum: row.checksum, created_at: toIso(row.created_at) })),
      more, ...(next ? { cursor: encodeKeysetCursor([next.cursor_created_at], next.id, filters) } : {}),
    };
  }

  async missions(requestId: string, query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    await this.persistence.staffRequest(this.dataSource, requestId, session, 'REQUEST_DETAIL_READ');
    const filters = { request_id: requestId, active: true };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : undefined;
    const limit = query.limit ?? 50;
    const rows = await this.dataSource.query(
      `SELECT id,status,team_id,created_at,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_created_at
         FROM mission WHERE request_id=$1 AND status IN ('OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE')
          AND ($2::timestamptz IS NULL OR (created_at,id)>($2::timestamptz,$3::uuid))
        ORDER BY created_at,id LIMIT $4`,
      [requestId, cursor?.sort[0] ?? null, cursor?.id ?? null, limit + 1],
    ) as Array<Record<string, unknown> & { id: string; created_at: Date | string; cursor_created_at: string }>;
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const next = more ? page.at(-1) : undefined;
    return { items: page.map((row) => ({ id: row.id, status: row.status, team_id: row.team_id, created_at: toIso(row.created_at) })), more,
      ...(next ? { cursor: encodeKeysetCursor([next.cursor_created_at], next.id, filters) } : {}) };
  }

  async duplicateCandidates(requestId: string, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const source = await this.persistence.staffRequest(this.dataSource, requestId, session, 'REQUEST_VERIFY');
    return this.findCandidates(source, session, false);
  }

  async verificationCandidates(requestId: string, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const source = await this.persistence.staffRequest(this.dataSource, requestId, session, 'REQUEST_VERIFY');
    return this.findCandidates(source, session, true);
  }

  private async findCandidates(source: OperationRequestRow, session: ReporterSession, independentOnly: boolean): Promise<Record<string, unknown>> {
    const values: unknown[] = [source.id, source.received_at];
    const scope = scopeSql(session.grants, 'REQUEST_VERIFY', values, 'candidate');
    const independence = independentOnly
      ? `AND (target.reporter_user_id IS NULL OR candidate.reporter_user_id IS DISTINCT FROM target.reporter_user_id)
         AND (target.reporter_contact_phone IS NULL OR candidate.reporter_contact_phone IS DISTINCT FROM target.reporter_contact_phone)
         AND (target.source_ip_hash IS NULL OR candidate.source_ip_hash IS DISTINCT FROM target.source_ip_hash)`
      : '';
    const rows = await this.dataSource.query(
      `SELECT candidate.id,candidate.tracking_code,candidate.status,candidate.review_lane,candidate.received_at,
              candidate.incident_category_code AS category,
              round(ST_Distance(subject.location,other.location)::numeric,1)::float8 AS distance_m
         FROM assistance_request target JOIN request_subject subject ON subject.request_id=target.id
         JOIN assistance_request candidate ON candidate.id<>target.id
         JOIN request_subject other ON other.request_id=candidate.id
        WHERE target.id=$1 AND candidate.status NOT IN ('DUPLICATE','REJECTED','CANCELLED')
          AND candidate.incident_category_code=target.incident_category_code
          AND candidate.received_at BETWEEN $2::timestamptz-interval '24 hours' AND $2::timestamptz+interval '24 hours'
          AND ST_DWithin(subject.location,other.location,1000) AND ${scope} ${independence}
        ORDER BY candidate.received_at,candidate.id LIMIT 21`,
      values,
    ) as Array<Record<string, unknown> & { received_at: Date | string }>;
    return { items: rows.slice(0, 20).map((row) => ({ ...row, received_at: toIso(row.received_at) })), more: rows.length > 20 };
  }

  private async scopedRequestSummary(requestId: string, session: ReporterSession): Promise<Array<Record<string, unknown>>> {
    const rows = await this.dataSource.query(
      `SELECT id,tracking_code,status,region_code,campaign_id,organization_id FROM assistance_request WHERE id=$1`, [requestId],
    ) as Array<Record<string, unknown> & { organization_id: string; region_code: string | null; campaign_id: string | null }>;
    const row = rows[0];
    if (!row) return [];
    if (!hasPermission(session.grants, 'REQUEST_DETAIL_READ', { organizationId: row.organization_id, regionCode: row.region_code, campaignId: row.campaign_id })) return [];
    return [{ id: row.id, tracking_code: row.tracking_code, status: row.status, region_code: row.region_code, campaign_id: row.campaign_id }];
  }

  private async staffEvents(
    queryable: Pick<DataSource | EntityManager, 'query'>, requestId: string, rawCursor: string | undefined, limit: number,
    session: ReporterSession,
  ): Promise<{ items: RequestEventRow[]; more: boolean; cursor?: string }> {
    const filters = { request_id: requestId, visibility: 'STAFF_TIMELINE', user_id: session.userId };
    const cursor = rawCursor ? decodeKeysetCursor(rawCursor, filters) : undefined;
    const rows = await queryable.query(
      `SELECT id,event_type,visibility,from_status,to_status,reason,payload,occurred_at,actor_user_id,
              to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_occurred_at
         FROM request_event WHERE request_id=$1
          AND ($2::timestamptz IS NULL OR (occurred_at,id)<($2::timestamptz,$3::uuid))
        ORDER BY occurred_at DESC,id DESC LIMIT $4`,
      [requestId, cursor?.sort[0] ?? null, cursor?.id ?? null, limit + 1],
    ) as RequestEventRow[];
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const next = more ? page.at(-1) : undefined;
    return { items: page, more, ...(next ? { cursor: encodeKeysetCursor([next.cursor_occurred_at], next.id, filters) } : {}) };
  }

  private async contactAttemptsPage(
    queryable: Pick<DataSource | EntityManager, 'query'>, requestId: string, rawCursor: string | undefined, limit: number,
  ): Promise<{ items: Array<Record<string, unknown>>; more: boolean; cursor?: string }> {
    const filters = { request_id: requestId, visibility: 'STAFF' };
    const cursor = rawCursor ? decodeKeysetCursor(rawCursor, filters) : undefined;
    const rows = await queryable.query(
      `SELECT id,contact_target,outcome,note,actor_user_id,attempted_at,
              to_char(attempted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_attempted_at
         FROM contact_attempt WHERE request_id=$1
          AND ($2::timestamptz IS NULL OR (attempted_at,id)<($2::timestamptz,$3::uuid))
        ORDER BY attempted_at DESC,id DESC LIMIT $4`,
      [requestId, cursor?.sort[0] ?? null, cursor?.id ?? null, limit + 1],
    ) as Array<Record<string, unknown> & { id: string; attempted_at: Date | string; cursor_attempted_at: string }>;
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const next = more ? page.at(-1) : undefined;
    return { items: page.map((row) => ({ id: row.id, contact_target: row.contact_target, outcome: row.outcome, note: row.note, actor_user_id: row.actor_user_id, attempted_at: toIso(row.attempted_at) })),
      more, ...(next ? { cursor: encodeKeysetCursor([next.cursor_attempted_at], next.id, filters) } : {}) };
  }

  private async duplicatesPage(
    queryable: Pick<DataSource | EntityManager, 'query'>, requestId: string, rawCursor: string | undefined, limit: number,
    session: ReporterSession,
  ): Promise<{ items: Array<Record<string, unknown>>; more: boolean; cursor?: string }> {
    const filters = filtersHash(session.grants, session.userId, { request_id: requestId }, 'duplicates');
    const cursor = rawCursor ? decodeKeysetCursor(rawCursor, filters) : undefined;
    const values: unknown[] = [requestId];
    const scope = scopeSql(session.grants, 'REQUEST_DETAIL_READ', values, 'child');
    const cursorTimeIndex = values.length + 1;
    values.push(cursor?.sort[0] ?? null, cursor?.id ?? null, limit + 1);
    const rows = await queryable.query(
      `SELECT child.id,child.tracking_code,child.status,child.received_at,
              to_char(child.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_received_at
         FROM assistance_request child WHERE child.canonical_request_id=$1 AND ${scope}
          AND ($${cursorTimeIndex}::timestamptz IS NULL OR (child.received_at,child.id)>($${cursorTimeIndex}::timestamptz,$${cursorTimeIndex + 1}::uuid))
        ORDER BY child.received_at,child.id LIMIT $${values.length}`,
      values,
    ) as Array<Record<string, unknown> & { id: string; received_at: Date | string; cursor_received_at: string }>;
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const next = more ? page.at(-1) : undefined;
    return { items: page.map((row) => ({ id: row.id, tracking_code: row.tracking_code, status: row.status, received_at: toIso(row.received_at) })),
      more, ...(next ? { cursor: encodeKeysetCursor([next.cursor_received_at], next.id, filters) } : {}) };
  }

  private async restrictEvents(events: RequestEventRow[], session: ReporterSession): Promise<RequestEventRow[]> {
    const ids = [...new Set(events.flatMap((event) => relatedRequestIds(asObject(event.payload))))];
    if (!ids.length) return events;
    const values: unknown[] = [ids];
    const scope = scopeSql(session.grants, 'REQUEST_DETAIL_READ', values);
    const rows = await this.dataSource.query(
      `SELECT r.id FROM assistance_request r WHERE r.id=ANY($1::uuid[]) AND ${scope}`,
      values,
    ) as Array<{ id: string }>;
    const allowed = new Set(rows.map((row) => row.id));
    return events.map((event) => ({ ...event, payload: restrictEventPayload(event, allowed) }));
  }
}
