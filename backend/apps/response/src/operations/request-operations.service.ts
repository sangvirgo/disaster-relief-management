import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentOutcome, IdempotentResult } from '../../../../packages/technical/src/idempotency';
import { decodeKeysetCursor, encodeKeysetCursor } from '../../../../packages/technical/src/keyset';
import { hasPermission, Permission } from '../../../../packages/technical/src/permissions';
import { ReporterSession, ReporterSessionService, RequestCoordinatorGrant } from '../requests/reporter-session';
import {
  AuthorityReferralDto, ContactAttemptDto, ConcurRequestDto, CorrectRegionDto, DuplicateRequestDto,
  RejectRequestDto, RequestQueueQueryDto, RequestOperationPageDto, RequestVersionDto,
  SupplementReviewDto, TriageRequestDto, VerifyRequestDto,
} from './request-operations.dto';
import { asObject, blockedCanonicalStatuses, checkVersion, cleanText, filtersHash, grantCovers, hasOrganizationPermission, loadOperationsConfig, openDangerStatuses, parseBbox, relatedRequestIds, restrictEventPayload, scopeSql, terminalStatuses, toIso, unverifiedStatuses, uuidPattern } from './request-operations.helpers';
import type { OperationRequestRow, QueueRow, RequestEventRow, RequestOperationsConfig, ValidatedSourceRefs } from './request-operations.types';
export type { RequestOperationsConfig } from './request-operations.types';

import { REQUEST_OPERATIONS_CONFIG } from './request-operations.config';
export { REQUEST_OPERATIONS_CONFIG } from './request-operations.config';

@Injectable()
export class RequestOperationsService {
  private readonly logger = new Logger(RequestOperationsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: ReporterSessionService,
    @Inject(REQUEST_OPERATIONS_CONFIG) private readonly config: RequestOperationsConfig,
  ) {}

  static config(): RequestOperationsConfig { return loadOperationsConfig(); }

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
    const row = await this.staffRequest(this.dataSource, requestId, session, 'REQUEST_DETAIL_READ');
    const [subjectRows, eventPage, attempts, decisionRows, missionRows, evidenceRows, canonicalRows, duplicateRows] = await Promise.all([
      this.dataSource.query(
        `SELECT people_affected,location_source,location_accuracy_m,location_captured_at,
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
        `SELECT id,status,created_at,team_id FROM mission WHERE request_id=$1 AND status IN ('OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE') ORDER BY created_at,id LIMIT 6`, [row.id],
      ) as Promise<Array<Record<string, unknown>>>,
      this.dataSource.query(
        `SELECT id,state,size_bytes,detected_mime,checksum,created_at FROM evidence_metadata WHERE request_id=$1 AND state='READY' ORDER BY created_at DESC,id DESC LIMIT 6`, [row.id],
      ) as Promise<Array<Record<string, unknown>>>,
      row.canonical_request_id ? this.scopedRequestSummary(row.canonical_request_id, session) : Promise.resolve([]),
      this.duplicatesPage(this.dataSource, row.id, undefined, 20, session),
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
      reporter: { user_id: row.reporter_user_id, name: row.reporter_name, contact_phone: row.reporter_contact_phone },
      subject: {
        people_affected: subject.people_affected,
        location: { type: 'Point', coordinates: [Number(subject.longitude), Number(subject.latitude)], source: subject.location_source, accuracy_m: subject.location_accuracy_m, captured_at: subject.location_captured_at == null ? null : toIso(subject.location_captured_at as Date | string) },
        reporter_relationship: subject.reporter_relationship, beneficiary_contact_phone: subject.beneficiary_contact_phone,
        alternate_contact: { name: subject.alternate_contact_name, phone: subject.alternate_contact_phone },
        information_source: subject.information_source,
        last_known_situation_at: subject.last_known_situation_at == null ? null : toIso(subject.last_known_situation_at as Date | string),
        contactability: subject.contactability, household_reference_note: subject.household_reference_note,
      },
      proxy_activity_flags: flagViews,
      timeline: { items: safeEvents.map((event) => this.eventView(event)), more: eventPage.more },
      contact_attempts: { items: attempts.items, more: attempts.more },
      verification_decision: decisionRows[0] ? this.decisionView(decisionRows[0]) : null,
      active_missions: { items: missionRows.slice(0, 5).map((mission) => ({ ...mission, created_at: toIso(mission.created_at as Date | string) })), more: missionRows.length > 5 },
      evidence: { items: evidenceRows.slice(0, 5).map((evidence) => ({ ...evidence, created_at: toIso(evidence.created_at as Date | string) })), more: evidenceRows.length > 5 },
      canonical: canonicalRows[0] ?? null,
      duplicates: { items: duplicateRows.items, more: duplicateRows.more },
    };
  }

  async events(requestId: string, query: RequestOperationPageDto, request: Request, sessionOverride?: ReporterSession): Promise<Record<string, unknown>> {
    const session = sessionOverride ?? await this.sessions.require(request);
    await this.staffRequest(this.dataSource, requestId, session, 'REQUEST_DETAIL_READ');
    const page = await this.staffEvents(this.dataSource, requestId, query.cursor, query.limit ?? 50, session);
    const items = await this.restrictEvents(page.items, session);
    return { items: items.map((event) => this.eventView(event)), more: page.more, ...(page.cursor ? { cursor: page.cursor } : {}) };
  }

  async contactAttempts(requestId: string, query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    await this.staffRequest(this.dataSource, requestId, session, 'REQUEST_DETAIL_READ');
    return this.contactAttemptsPage(this.dataSource, requestId, query.cursor, query.limit ?? 50);
  }

  async duplicates(requestId: string, query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    await this.staffRequest(this.dataSource, requestId, session, 'REQUEST_DETAIL_READ');
    return this.duplicatesPage(this.dataSource, requestId, query.cursor, query.limit ?? 50, session);
  }

  async evidence(requestId: string, query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    await this.staffRequest(this.dataSource, requestId, session, 'REQUEST_DETAIL_READ');
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
    await this.staffRequest(this.dataSource, requestId, session, 'REQUEST_DETAIL_READ');
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
    const source = await this.staffRequest(this.dataSource, requestId, session, 'REQUEST_VERIFY');
    return this.findCandidates(source, session, false);
  }

  async verificationCandidates(requestId: string, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const source = await this.staffRequest(this.dataSource, requestId, session, 'REQUEST_VERIFY');
    return this.findCandidates(source, session, true);
  }

  async startVerification(requestId: string, dto: RequestVersionDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    return this.runCommand(requestId, session, key, 'response.requests.start-verification', dto,
      async (manager) => {
        const row = await this.staffRequest(manager, requestId, session, 'REQUEST_VERIFY', true);
        checkVersion(Number(row.version), dto.expected_version);
        if (row.status !== 'SUBMITTED') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const [updated] = await manager.query(
          `UPDATE assistance_request SET status='VERIFYING',verifying_since=clock_timestamp(),version=version+1
            WHERE id=$1 AND version=$2 RETURNING id,status,version,verifying_since`,
          [row.id, dto.expected_version],
        ) as [Array<{ id: string; status: string; version: number; verifying_since: Date | string }>, number];
        if (!updated[0]) checkVersion(Number(row.version), dto.expected_version);
        await this.insertEvent(manager, row.id, session.userId, 'VERIFICATION_STARTED', 'REPORTER', row.status, 'VERIFYING', null, { public_text_code: 'REQUEST_VERIFYING' });
        await this.notifyReporter(manager, row.reporter_user_id, row.id, Number(updated[0]!.version), 'REQUEST_STATUS_CHANGED', 'REQUEST_VERIFYING');
        const value = { id: row.id, status: updated[0]!.status, version: Number(updated[0]!.version), verifying_since: toIso(updated[0]!.verifying_since) };
        return { status: 200, value, resource: { type: 'assistance_request', id: row.id } };
      },
      (manager) => this.currentRequestValue(manager, requestId),
    );
  }

  async addContactAttempt(requestId: string, dto: ContactAttemptDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const note = cleanText(dto.note ?? undefined);
    return this.runCommand(requestId, session, key, 'response.requests.contact-attempt', dto,
      async (manager) => {
        const row = await this.staffRequest(manager, requestId, session, 'REQUEST_VERIFY', true);
        if (row.status !== 'VERIFYING') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const attemptRows = await manager.query(
          `INSERT INTO contact_attempt (request_id,actor_user_id,contact_target,outcome,note)
           VALUES ($1,$2,$3,$4,$5) RETURNING id,contact_target,outcome,note,actor_user_id,attempted_at`,
          [row.id, session.userId, dto.contact_target, dto.outcome, note],
        ) as Array<Record<string, unknown> & { id: string; attempted_at: Date | string }>;
        const attempt = attemptRows[0];
        if (!attempt) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const [updated] = await manager.query(
          'UPDATE assistance_request SET version=version+1 WHERE id=$1 RETURNING version', [row.id],
        ) as [Array<{ version: number }>, number];
        await this.insertEvent(manager, row.id, session.userId, 'CONTACT_ATTEMPT_RECORDED', 'STAFF', row.status, row.status, null, {
          contact_attempt_id: attempt.id, outcome: dto.outcome, contact_target: dto.contact_target,
        });
        return {
          status: 201,
          value: { id: attempt.id, contact_target: attempt.contact_target, outcome: attempt.outcome, note: attempt.note, actor_user_id: attempt.actor_user_id, attempted_at: toIso(attempt.attempted_at), version: Number(updated[0]?.version) },
          resource: { type: 'contact_attempt', id: attempt.id },
        };
      },
      async (manager, resource) => {
        await this.staffRequest(manager, requestId, session, 'REQUEST_VERIFY');
        const rows = await manager.query('SELECT id,contact_target,outcome,note,actor_user_id,attempted_at FROM contact_attempt WHERE id=$1 AND request_id=$2', [resource?.id, requestId]) as Array<Record<string, unknown> & { id: string; attempted_at: Date | string }>;
        const attempt = rows[0];
        if (!attempt) throw new AppError('NOT_FOUND', { status: 404 });
        const current = await this.currentRequestValue(manager, requestId);
        return { ...attempt, attempted_at: toIso(attempt.attempted_at), version: current.version };
      },
    );
  }

  async verify(requestId: string, dto: VerifyRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const reason = cleanText(dto.reason ?? undefined);
    const sourceNote = cleanText(dto.source_note ?? undefined);
    const currentCoordinators = dto.basis === 'TWO_COORDINATOR_JUDGMENT'
      ? await this.sessions.requestCoordinatorGrants((await this.staffRequest(this.dataSource, requestId, session, 'REQUEST_VERIFY')).organization_id)
      : undefined;
    return this.runCommand(requestId, session, key, 'response.requests.verify', dto,
      async (manager) => {
        const row = await this.staffRequest(manager, requestId, session, 'REQUEST_VERIFY', true);
        checkVersion(Number(row.version), dto.expected_version);
        if (row.status !== 'VERIFYING') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (await this.hasPendingSupplement(manager, row.id)) throw new AppError('PENDING_SUPPLEMENT_REVIEW', { status: 409 });
        const attemptRows = await manager.query('SELECT id,outcome FROM contact_attempt WHERE request_id=$1', [row.id]) as Array<{ id: string; outcome: string }>;
        if (!attemptRows.length && !reason) throw new AppError('NO_CONTACT_ATTEMPT', { status: 409 });
        const refs = await this.validateSourceRefs(manager, row, dto.source_refs, session);
        if (dto.basis === 'CONTACT_CONFIRMED' && !refs.attempts.some((attempt) => attempt.outcome === 'REACHED') && !attemptRows.some((attempt) => attempt.outcome === 'REACHED')) {
          throw new AppError('VERIFICATION_BASIS_REQUIRED', { status: 400 });
        }
        if (dto.basis === 'CORROBORATED' && !refs.requests.length && !sourceNote) throw new AppError('VERIFICATION_BASIS_REQUIRED', { status: 400 });
        if (dto.basis === 'EVIDENCE_REVIEWED' && !refs.evidence.length) throw new AppError('VERIFICATION_BASIS_REQUIRED', { status: 400 });
        let concurringUserId: string | null = null;
        if (dto.basis === 'TWO_COORDINATOR_JUDGMENT') {
          if (!reason || !dto.concurrence_event_id) throw new AppError('SECOND_COORDINATOR_REQUIRED', { status: 409 });
          const concurrence = await this.validConcurrence(manager, row, dto.concurrence_event_id, session.userId, currentCoordinators ?? []);
          concurringUserId = concurrence.actor_user_id;
        } else if (dto.concurrence_event_id) {
          throw new AppError('VALIDATION_FAILED', { status: 400 });
        }
        if (row.report_mode === 'PROXY' && !refs.independent && dto.basis !== 'TWO_COORDINATOR_JUDGMENT') {
          throw new AppError('SECOND_COORDINATOR_REQUIRED', { status: 409 });
        }
        const approvedFacts = await this.approvedFacts(manager, row.id);
        const decisionRows = await manager.query(
          `INSERT INTO verification_decision (request_id,outcome,basis,reviewer_user_id,concurring_user_id,reason)
           VALUES ($1,'VERIFIED',$2,$3,$4,$5) RETURNING id`,
          [row.id, dto.basis, session.userId, concurringUserId, reason],
        ) as Array<{ id: string }>;
        const decision = decisionRows[0];
        if (!decision) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const eventId = await this.insertEvent(manager, row.id, session.userId, 'REQUEST_VERIFIED', 'REPORTER', row.status, 'VERIFIED', reason, {
          public_text_code: 'REQUEST_VERIFIED', basis: dto.basis, decision_id: decision.id,
          source_refs: this.serializeSourceRefs(dto.source_refs), source_note: sourceNote,
          concurring_user_id: concurringUserId, approved_facts: approvedFacts,
        });
        const [updated] = await manager.query(
          `UPDATE assistance_request SET status='VERIFIED',verification_revision=$3,version=version+1
            WHERE id=$1 AND version=$2 RETURNING id,status,version,verification_revision`,
          [row.id, dto.expected_version, eventId],
        ) as [Array<{ id: string; status: string; version: number; verification_revision: string }>, number];
        if (!updated[0]) checkVersion(Number(row.version), dto.expected_version);
        await this.notifyReporter(manager, row.reporter_user_id, row.id, Number(updated[0]!.version), 'REQUEST_STATUS_CHANGED', 'REQUEST_VERIFIED');
        return { status: 200, value: { id: row.id, status: updated[0]!.status, version: Number(updated[0]!.version), verification_revision: updated[0]!.verification_revision, decision_id: decision.id }, resource: { type: 'verification_decision', id: decision.id } };
      },
      async (manager, resource) => {
        await this.staffRequest(manager, requestId, session, 'REQUEST_VERIFY');
        const rows = await manager.query('SELECT id FROM verification_decision WHERE id=$1 AND request_id=$2', [resource?.id, requestId]) as Array<{ id: string }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        const current = await this.currentRequestValue(manager, requestId);
        return { ...current, decision_id: rows[0].id };
      },
    );
  }

  async concur(requestId: string, dto: ConcurRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const note = cleanText(dto.note, true);
    return this.runCommand(requestId, session, key, 'response.requests.concur', dto,
      async (manager) => {
        const row = await this.staffRequest(manager, requestId, session, 'REQUEST_VERIFY', true);
        checkVersion(Number(row.version), dto.expected_version);
        if (row.status !== 'VERIFYING') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const startedBy = await manager.query(
          `SELECT actor_user_id FROM request_event WHERE request_id=$1 AND event_type='VERIFICATION_STARTED' ORDER BY occurred_at,id LIMIT 1`, [row.id],
        ) as Array<{ actor_user_id: string | null }>;
        if (startedBy[0]?.actor_user_id === session.userId) throw new AppError('SECOND_COORDINATOR_REQUIRED', { status: 409 });
        const materialFactEventId = await this.latestMaterialFactEventId(manager, row.id);
        const resultingVersion = Number(row.version) + 1;
        const eventId = await this.insertEvent(manager, row.id, session.userId, 'CONCURRENCE', 'STAFF', row.status, row.status, note, {
          reviewed_version: Number(row.version), resulting_version: resultingVersion, material_fact_event_id: materialFactEventId,
        });
        const [updated] = await manager.query('UPDATE assistance_request SET version=version+1 WHERE id=$1 AND version=$2 RETURNING version', [row.id, dto.expected_version]) as [Array<{ version: number }>, number];
        if (!updated[0]) checkVersion(Number(row.version), dto.expected_version);
        return { status: 200, value: { id: row.id, status: row.status, version: Number(updated[0]!.version), event_id: eventId }, resource: { type: 'request_event', id: eventId } };
      },
      async (manager, resource) => {
        await this.staffRequest(manager, requestId, session, 'REQUEST_VERIFY');
        const rows = await manager.query('SELECT id FROM request_event WHERE id=$1 AND request_id=$2 AND event_type=\'CONCURRENCE\'', [resource?.id, requestId]) as Array<{ id: string }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        const current = await this.currentRequestValue(manager, requestId);
        return { ...current, event_id: rows[0].id };
      },
    );
  }

  async reject(requestId: string, dto: RejectRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const reason = cleanText(dto.reason, true)!;
    const reasonKind = dto.reason_kind ?? 'OTHER';
    await this.staffRequest(this.dataSource, requestId, session, 'REQUEST_VERIFY');
    const knownChildren = await this.dataSource.query(
      'SELECT id,organization_id FROM assistance_request WHERE canonical_request_id=$1 ORDER BY id', [requestId],
    ) as Array<{ id: string; organization_id: string }>;
    const coordinatorGrants = new Map<string, RequestCoordinatorGrant[]>();
    for (const organizationId of new Set(knownChildren.map((child) => child.organization_id))) {
      coordinatorGrants.set(organizationId, await this.sessions.requestCoordinatorGrants(organizationId));
    }
    return this.runCommand(requestId, session, key, 'response.requests.reject', dto,
      async (manager) => {
        const lockedRows = new Map<string, Pick<OperationRequestRow,
          'id' | 'reporter_user_id' | 'status' | 'version' | 'organization_id' | 'region_code' | 'campaign_id' | 'canonical_request_id'>>();
        for (const id of [...new Set([requestId, ...knownChildren.map((child) => child.id)])].sort()) {
          const rows = await manager.query(
            `SELECT id,reporter_user_id,status,version,organization_id,region_code,campaign_id,canonical_request_id
               FROM assistance_request WHERE id=$1 FOR UPDATE`, [id],
          ) as Array<Pick<OperationRequestRow,
            'id' | 'reporter_user_id' | 'status' | 'version' | 'organization_id' | 'region_code' | 'campaign_id' | 'canonical_request_id'>>;
          if (rows[0]) lockedRows.set(id, rows[0]);
        }
        const row = lockedRows.get(requestId);
        if (!row) throw new AppError('NOT_FOUND', { status: 404 });
        if (!hasPermission(session.grants, 'REQUEST_VERIFY', { organizationId: row.organization_id, regionCode: row.region_code, campaignId: row.campaign_id })) {
          throw new AppError('FORBIDDEN', { status: 403 });
        }
        const childRows = [...lockedRows.values()].filter((child) => child.canonical_request_id === requestId);
        const currentChildren = await manager.query(
          'SELECT id,organization_id FROM assistance_request WHERE canonical_request_id=$1 ORDER BY id', [requestId],
        ) as Array<{ id: string; organization_id: string }>;
        const knownIds = new Set(knownChildren.map((child) => child.id));
        if (currentChildren.length !== childRows.length || currentChildren.some((child) => !knownIds.has(child.id))) {
          throw new AppError('DUPLICATE_SET_CHANGED', { status: 409 });
        }
        if (currentChildren.some((child) => !coordinatorGrants.has(child.organization_id))) {
          throw new AppError('DUPLICATE_SET_CHANGED', { status: 409 });
        }
        checkVersion(Number(row.version), dto.expected_version);
        if (!unverifiedStatuses.has(row.status)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (reasonKind === 'UNREACHABLE') {
          const attempts = await manager.query(
            `SELECT count(*)::int AS count,extract(epoch FROM max(attempted_at)-min(attempted_at)) AS span_seconds
               FROM contact_attempt WHERE request_id=$1 AND contact_target IN ('REPORTER','ALTERNATE') AND outcome<>'REACHED'`, [row.id],
          ) as Array<{ count: number; span_seconds: number | null }>;
          if (Number(attempts[0]?.count ?? 0) < 3 || Number(attempts[0]?.span_seconds ?? 0) < 1_800) throw new AppError('REJECT_THRESHOLD_NOT_MET', { status: 409 });
        }
        const decisions = await manager.query(
          `INSERT INTO verification_decision (request_id,outcome,reviewer_user_id,reason,reason_kind)
           VALUES ($1,'REJECTED',$2,$3,$4) RETURNING id`, [row.id, session.userId, reason, reasonKind],
        ) as Array<{ id: string }>;
        const decision = decisions[0];
        if (!decision) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const eventId = await this.insertEvent(manager, row.id, session.userId, 'REQUEST_REJECTED', 'REPORTER', row.status, 'REJECTED', reason, {
          public_text_code: 'REQUEST_REJECTED', decision_id: decision.id, reason_kind: reasonKind,
        });
        const [updated] = await manager.query(
          `UPDATE assistance_request SET status='REJECTED',version=version+1
            WHERE id=$1 AND version=$2 RETURNING id,status,version`, [row.id, dto.expected_version],
        ) as [Array<{ id: string; status: string; version: number }>, number];
        if (!updated[0]) checkVersion(Number(row.version), dto.expected_version);
        await this.notifyReporter(manager, row.reporter_user_id, row.id, Number(updated[0]!.version), 'REQUEST_STATUS_CHANGED', 'REQUEST_REJECTED');
        const orphaned: Array<{ id: string; status: string; version: number }> = [];
        for (const child of childRows) {
          await this.insertEvent(manager, child.id, null, 'DUPLICATE_ORPHANED', 'REPORTER', 'DUPLICATE', 'VERIFYING', null, {
            public_text_code: 'DUPLICATE_ORPHANED', canonical_request_id: requestId, rejection_decision_id: decision.id,
            resulting_version: Number(child.version) + 1,
          });
          const [childUpdate] = await manager.query(
            `UPDATE assistance_request SET status='VERIFYING',canonical_request_id=NULL,verifying_since=clock_timestamp(),version=version+1
              WHERE id=$1 AND status='DUPLICATE' AND canonical_request_id=$2 RETURNING version`, [child.id, requestId],
          ) as [Array<{ version: number }>, number];
          if (!childUpdate[0]) throw new AppError('DUPLICATE_SET_CHANGED', { status: 409 });
          const version = Number(childUpdate[0].version);
          await this.notifyReporter(manager, child.reporter_user_id, child.id, version, 'REQUEST_STATUS_CHANGED', 'DUPLICATE_ORPHANED');
          const recipients = [...new Set((coordinatorGrants.get(child.organization_id) ?? [])
            .filter((grant) => grantCovers(grant, child)).map((grant) => grant.user_id))];
          if (recipients.length) await manager.query(
            `INSERT INTO notice (source_id,source_version,recipient_user_id,notice_type,payload)
             SELECT $1,$2,recipient,'DUPLICATE_ORPHANED',jsonb_build_object('text_code','DUPLICATE_ORPHANED','request_id',$1)
               FROM unnest($3::uuid[]) AS recipient
             ON CONFLICT DO NOTHING`, [child.id, version, recipients],
          );
          if (hasPermission(session.grants, 'REQUEST_DETAIL_READ', { organizationId: child.organization_id, regionCode: child.region_code, campaignId: child.campaign_id })) {
            orphaned.push({ id: child.id, status: 'VERIFYING', version });
          }
        }
        return { status: 200, value: { id: row.id, status: updated[0]!.status, version: Number(updated[0]!.version), decision_id: decision.id,
          event_id: eventId, orphaned_duplicates: { items: orphaned.slice(0, 20), more: orphaned.length > 20 } }, resource: { type: 'verification_decision', id: decision.id } };
      },
      async (manager, resource) => {
        await this.staffRequest(manager, requestId, session, 'REQUEST_VERIFY');
        const rows = await manager.query('SELECT id FROM verification_decision WHERE id=$1 AND request_id=$2 AND outcome=\'REJECTED\'', [resource?.id, requestId]) as Array<{ id: string }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        const current = await this.currentRequestValue(manager, requestId);
        const events = await manager.query(
          `SELECT orphan.request_id AS id,orphan.to_status AS status,
                  (orphan.payload->>'resulting_version')::int AS version,
                  child.organization_id,child.region_code,child.campaign_id
             FROM request_event orphan JOIN assistance_request child ON child.id=orphan.request_id
            WHERE orphan.event_type='DUPLICATE_ORPHANED' AND orphan.payload->>'rejection_decision_id'=$1
            ORDER BY orphan.occurred_at,orphan.id`, [rows[0].id],
        ) as Array<{ id: string; status: string; version: number; organization_id: string; region_code: string | null; campaign_id: string | null }>;
        const visible = events.filter((child) => hasPermission(session.grants, 'REQUEST_DETAIL_READ', {
          organizationId: child.organization_id, regionCode: child.region_code, campaignId: child.campaign_id,
        }));
        return { ...current, decision_id: rows[0].id, orphaned_duplicates: { items: visible.slice(0, 20).map(({ id, status, version }) => ({ id, status, version })), more: visible.length > 20 } };
      },
    );
  }

  async duplicate(requestId: string, dto: DuplicateRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const reason = cleanText(dto.reason, true)!;
    return this.runCommand(requestId, session, key, 'response.requests.duplicate', dto,
      async (manager) => {
        const ids = [...new Set([requestId, dto.canonical_request_id])].sort();
        const locked = new Map<string, OperationRequestRow>();
        for (const id of ids) {
          const rows = await manager.query(
            `SELECT id,tracking_code,reporter_user_id,reporter_name,reporter_contact_phone,report_mode,status,version,
                    review_lane,received_at,verifying_since,organization_id,region_code,campaign_id,description,
                    reporter_declared_danger,priority,priority_basis,work_cycle,canonical_request_id,incident_category_code
               FROM assistance_request WHERE id=$1 FOR UPDATE`, [id],
          ) as OperationRequestRow[];
          if (rows[0]) locked.set(id, rows[0]);
        }
        const source = locked.get(requestId);
        const canonical = locked.get(dto.canonical_request_id);
        if (!source) throw new AppError('NOT_FOUND', { status: 404 });
        if (!hasPermission(session.grants, 'REQUEST_VERIFY', { organizationId: source.organization_id, regionCode: source.region_code, campaignId: source.campaign_id })) throw new AppError('FORBIDDEN', { status: 403 });
        if (!canonical || canonical.id === source.id || blockedCanonicalStatuses.has(canonical.status) ||
            !hasPermission(session.grants, 'REQUEST_VERIFY', { organizationId: canonical.organization_id, regionCode: canonical.region_code, campaignId: canonical.campaign_id })) {
          throw new AppError('CANONICAL_INVALID', { status: 409 });
        }
        checkVersion(Number(source.version), dto.expected_version);
        if (!unverifiedStatuses.has(source.status)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const inbound = await manager.query('SELECT 1 FROM assistance_request WHERE canonical_request_id=$1 LIMIT 1', [source.id]) as unknown[];
        if (inbound.length) throw new AppError('CANONICAL_HAS_DUPLICATES', { status: 409 });
        const decisions = await manager.query(
          `INSERT INTO verification_decision (request_id,outcome,reviewer_user_id,reason)
           VALUES ($1,'DUPLICATE',$2,$3) RETURNING id`, [source.id, session.userId, reason],
        ) as Array<{ id: string }>;
        const decision = decisions[0];
        if (!decision) throw new AppError('INTERNAL_ERROR', { status: 500 });
        await this.insertEvent(manager, source.id, session.userId, 'REQUEST_DUPLICATED', 'REPORTER', source.status, 'DUPLICATE', reason, {
          public_text_code: 'REQUEST_DUPLICATED', decision_id: decision.id, canonical_request_id: canonical.id,
        });
        const [updated] = await manager.query(
          `UPDATE assistance_request SET status='DUPLICATE',canonical_request_id=$3,version=version+1
            WHERE id=$1 AND version=$2 RETURNING id,status,version,canonical_request_id`,
          [source.id, dto.expected_version, canonical.id],
        ) as [Array<{ id: string; status: string; version: number; canonical_request_id: string }>, number];
        if (!updated[0]) checkVersion(Number(source.version), dto.expected_version);
        await this.notifyReporter(manager, source.reporter_user_id, source.id, Number(updated[0]!.version), 'REQUEST_STATUS_CHANGED', 'REQUEST_DUPLICATED');
        return { status: 200, value: { id: source.id, status: updated[0]!.status, version: Number(updated[0]!.version), canonical_request_id: updated[0]!.canonical_request_id, decision_id: decision.id }, resource: { type: 'verification_decision', id: decision.id } };
      },
      async (manager, resource) => {
        await this.staffRequest(manager, requestId, session, 'REQUEST_VERIFY');
        const rows = await manager.query('SELECT id FROM verification_decision WHERE id=$1 AND request_id=$2 AND outcome=\'DUPLICATE\'', [resource?.id, requestId]) as Array<{ id: string }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        return this.currentRequestValue(manager, requestId);
      },
    );
  }

  async triage(requestId: string, dto: TriageRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const reason = cleanText(dto.reason ?? undefined);
    return this.runCommand(requestId, session, key, 'response.requests.triage', dto,
      async (manager) => {
        const row = await this.staffRequest(manager, requestId, session, 'REQUEST_TRIAGE', true);
        checkVersion(Number(row.version), dto.expected_version);
        if (!['VERIFIED', 'TRIAGED', 'DISPATCHED', 'IN_PROGRESS'].includes(row.status)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const oldRank = row.priority ? Number(row.priority.slice(1)) : null;
        const nextRank = Number(dto.priority.slice(1));
        if (oldRank !== null && oldRank < 3 && nextRank > oldRank && !reason) throw new AppError('REASON_REQUIRED', { status: 400 });
        const nextStatus = row.status === 'VERIFIED' ? 'TRIAGED' : row.status;
        if (nextStatus === row.status && row.priority === dto.priority && row.priority_basis === dto.priority_basis) {
          return { status: 200, value: { id: row.id, status: row.status, version: Number(row.version), priority: row.priority, priority_basis: row.priority_basis }, resource: { type: 'assistance_request', id: row.id } };
        }
        const eventType = row.status === 'VERIFIED' ? 'REQUEST_TRIAGED' : oldRank !== null && nextRank > oldRank ? 'PRIORITY_REDUCED' : 'PRIORITY_CHANGED';
        const [updated] = await manager.query(
          `UPDATE assistance_request SET status=$3,priority=$4,priority_basis=$5,version=version+1
            WHERE id=$1 AND version=$2 RETURNING id,status,version,priority,priority_basis`,
          [row.id, dto.expected_version, nextStatus, dto.priority, dto.priority_basis],
        ) as [Array<{ id: string; status: string; version: number; priority: string; priority_basis: string }>, number];
        if (!updated[0]) checkVersion(Number(row.version), dto.expected_version);
        await this.insertEvent(manager, row.id, session.userId, eventType, nextStatus !== row.status ? 'REPORTER' : 'STAFF', row.status, nextStatus, reason, {
          public_text_code: nextStatus !== row.status ? 'REQUEST_TRIAGED' : undefined,
          priority: dto.priority, priority_basis: dto.priority_basis,
        });
        if (nextStatus !== row.status) await this.notifyReporter(manager, row.reporter_user_id, row.id, Number(updated[0]!.version), 'REQUEST_STATUS_CHANGED', 'REQUEST_TRIAGED');
        return { status: 200, value: { id: row.id, status: updated[0]!.status, version: Number(updated[0]!.version), priority: updated[0]!.priority, priority_basis: updated[0]!.priority_basis }, resource: { type: 'assistance_request', id: row.id } };
      },
      (manager) => this.currentRequestValue(manager, requestId),
    );
  }

  async authorityReferral(requestId: string, dto: AuthorityReferralDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const referredBody = cleanText(dto.referred_body, true)!;
    const note = cleanText(dto.note, true)!;
    return this.runCommand(requestId, session, key, 'response.requests.authority-referral', dto,
      async (manager) => {
        const row = await this.staffRequest(manager, requestId, session, 'REQUEST_VERIFY', true);
        if (terminalStatuses.has(row.status) || row.status === 'RESOLVING') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const [updated] = await manager.query('UPDATE assistance_request SET version=version+1 WHERE id=$1 RETURNING version', [row.id]) as [Array<{ version: number }>, number];
        const eventId = await this.insertEvent(manager, row.id, session.userId, 'AUTHORITY_REFERRED', 'STAFF', row.status, row.status, note, { referred_body: referredBody });
        return { status: 201, value: { id: row.id, status: row.status, version: Number(updated[0]?.version), event_id: eventId }, resource: { type: 'request_event', id: eventId } };
      },
      async (manager, resource) => {
        await this.staffRequest(manager, requestId, session, 'REQUEST_VERIFY');
        const rows = await manager.query('SELECT id FROM request_event WHERE id=$1 AND request_id=$2 AND event_type=\'AUTHORITY_REFERRED\'', [resource?.id, requestId]) as Array<{ id: string }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        return { ...(await this.currentRequestValue(manager, requestId)), event_id: rows[0].id };
      },
    );
  }

  async correctRegion(requestId: string, dto: CorrectRegionDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const reason = cleanText(dto.reason, true)!;
    return this.runCommand(requestId, session, key, 'response.requests.correct-region', dto,
      async (manager) => {
        const row = await this.staffRequest(manager, requestId, session, 'REQUEST_UNASSIGNED_QUEUE', true);
        if (!hasOrganizationPermission(session, 'REQUEST_UNASSIGNED_QUEUE', row.organization_id)) throw new AppError('FORBIDDEN', { status: 403 });
        checkVersion(Number(row.version), dto.expected_version);
        if (row.attribution_locked_at) throw new AppError('ATTRIBUTION_LOCKED', { status: 409 });
        const regions = await manager.query('SELECT 1 FROM region_boundary WHERE region_code=$1', [dto.region_code]) as unknown[];
        if (!regions.length) throw new AppError('VALIDATION_FAILED', { status: 400 });
        if (row.region_code === dto.region_code) return { status: 200, value: { id: row.id, region_code: row.region_code, version: Number(row.version) }, resource: { type: 'assistance_request', id: row.id } };
        const [updated] = await manager.query(
          'UPDATE assistance_request SET region_code=$3,version=version+1 WHERE id=$1 AND version=$2 RETURNING region_code,version',
          [row.id, dto.expected_version, dto.region_code],
        ) as [Array<{ region_code: string; version: number }>, number];
        if (!updated[0]) checkVersion(Number(row.version), dto.expected_version);
        await this.insertEvent(manager, row.id, session.userId, 'REGION_CORRECTED', 'STAFF', row.status, row.status, reason, { previous_region_code: row.region_code, region_code: updated[0]!.region_code });
        return { status: 200, value: { id: row.id, region_code: updated[0]!.region_code, version: Number(updated[0]!.version) }, resource: { type: 'assistance_request', id: row.id } };
      },
      (manager) => this.currentRequestValue(manager, requestId),
    );
  }

  async reviewSupplement(
    requestId: string, eventId: string, dto: SupplementReviewDto, key: string, request: Request,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const reason = cleanText(dto.reason, true)!;
    const sourceNote = cleanText(dto.source_note ?? undefined);
    return this.runCommand(requestId, session, key, 'response.requests.review-supplement', { event_id: eventId, ...dto },
      async (manager) => {
        const row = await this.staffRequest(manager, requestId, session, 'REQUEST_VERIFY', true);
        checkVersion(Number(row.version), dto.expected_version);
        if (!['VERIFYING', 'VERIFIED', 'TRIAGED', 'DISPATCHED', 'IN_PROGRESS'].includes(row.status)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const supplementRows = await manager.query(
          `SELECT id,payload FROM request_event WHERE id=$1 AND request_id=$2 AND event_type='REPORTER_SUPPLEMENT'`, [eventId, row.id],
        ) as Array<{ id: string; payload: Record<string, unknown> | null }>;
        const supplement = supplementRows[0];
        if (!supplement || asObject(supplement.payload).pending_review !== true) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const reviewed = await manager.query(
          `SELECT 1 FROM request_event WHERE request_id=$1 AND event_type='SUPPLEMENT_REVIEW' AND payload->>'reviewed_event_id'=$2 LIMIT 1`, [row.id, eventId],
        ) as unknown[];
        if (reviewed.length) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        await this.validateSourceRefs(manager, row, dto.source_refs, session);
        const reported = asObject(asObject(supplement.payload).reported_facts);
        let nextRegion = row.region_code;
        if (dto.decision === 'ACCEPT' && reported.location !== undefined) {
          const location = asObject(reported.location);
          const coordinates = Array.isArray(location.coordinates) ? location.coordinates : [];
          const [longitude, latitude] = coordinates;
          if (coordinates.length !== 2 || typeof longitude !== 'number' || typeof latitude !== 'number' ||
              longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) throw new AppError('INTERNAL_ERROR', { status: 500 });
          const regionRows = await manager.query(
            `SELECT min(region_code) AS region_code FROM region_boundary
              WHERE ST_Covers(geom,ST_SetSRID(ST_MakePoint($1,$2),4326)) HAVING count(*)=1`, [longitude, latitude],
          ) as Array<{ region_code: string }>;
          nextRegion = regionRows[0]?.region_code ?? null;
          if (!hasPermission(session.grants, 'REQUEST_VERIFY', { organizationId: row.organization_id, regionCode: nextRegion, campaignId: row.campaign_id })) {
            throw new AppError('FORBIDDEN', { status: 403 });
          }
        }
        const approvedFacts = dto.decision === 'ACCEPT' ? await this.approvedFacts(manager, row.id, reported, nextRegion) : undefined;
        const reviewId = await this.insertEvent(manager, row.id, session.userId, 'SUPPLEMENT_REVIEW', 'STAFF', row.status, row.status, reason, {
          reviewed_event_id: eventId, decision: dto.decision, source_refs: this.serializeSourceRefs(dto.source_refs),
          source_note: sourceNote, ...(approvedFacts ? { approved_facts: approvedFacts } : {}),
        });
        if (dto.decision === 'ACCEPT') await this.applySupplementFacts(manager, row.id, reported);
        const [updated] = await manager.query(
          `UPDATE assistance_request SET
             description=CASE WHEN $3::boolean THEN $4 ELSE description END,
             reporter_declared_danger=CASE WHEN $5::boolean THEN $6 ELSE reporter_declared_danger END,
             region_code=CASE WHEN $7::boolean THEN $8 ELSE region_code END,
             verification_revision=CASE WHEN $9::boolean THEN $10::uuid ELSE verification_revision END,
             version=version+1 WHERE id=$1 AND version=$2 RETURNING status,version,verification_revision`,
          [row.id, dto.expected_version,
            dto.decision === 'ACCEPT' && Object.hasOwn(reported, 'description'), reported.description ?? null,
            dto.decision === 'ACCEPT' && Object.hasOwn(reported, 'reporter_declared_danger'), reported.reporter_declared_danger ?? false,
            dto.decision === 'ACCEPT' && Object.hasOwn(reported, 'location'), nextRegion,
            dto.decision === 'ACCEPT', reviewId],
        ) as [Array<{ status: string; version: number; verification_revision: string | null }>, number];
        if (!updated[0]) checkVersion(Number(row.version), dto.expected_version);
        await this.notifyReporter(manager, row.reporter_user_id, row.id, Number(updated[0]!.version), 'SUPPLEMENT_REVIEWED', `SUPPLEMENT_${dto.decision}`);
        return { status: 200, value: { id: row.id, status: updated[0]!.status, version: Number(updated[0]!.version), decision: dto.decision, event_id: reviewId, verification_revision: updated[0]!.verification_revision }, resource: { type: 'request_event', id: reviewId } };
      },
      async (manager, resource) => {
        await this.staffRequest(manager, requestId, session, 'REQUEST_VERIFY');
        const rows = await manager.query('SELECT id,payload FROM request_event WHERE id=$1 AND request_id=$2 AND event_type=\'SUPPLEMENT_REVIEW\'', [resource?.id, requestId]) as Array<{ id: string; payload: Record<string, unknown> }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        const current = await this.currentRequestValue(manager, requestId);
        return { ...current, event_id: rows[0].id, decision: rows[0].payload.decision };
      },
    );
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

  private runCommand<T>(
    requestId: string,
    session: ReporterSession,
    key: string,
    command: string,
    dto: unknown,
    execute: (manager: EntityManager) => Promise<IdempotentOutcome<T>>,
    replay: (manager: EntityManager, resource: { type: string; id: string } | null, status: number) => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.request-operation:${requestId}:${session.userId}`,
      command, key,
      requestHash: canonicalRequestHash({ request_id: requestId, actor_user_id: session.userId, dto }),
      execute, replay,
    }).catch((error: unknown) => {
      if (!(error instanceof AppError) || error.code === 'INTERNAL_ERROR') {
        const value = error && typeof error === 'object' ? error as { code?: unknown; driverError?: { code?: unknown } } : {};
        const sqlState = value.driverError?.code ?? value.code;
        const code = error instanceof AppError ? error.code
          : typeof sqlState === 'string' && /^[0-9A-Z]{5}$/u.test(sqlState) ? `DATABASE_${sqlState}`
            : error instanceof TypeError ? 'UNEXPECTED_TYPE_ERROR' : 'UNEXPECTED_ERROR';
        this.logger.error({ code }, command);
      }
      throw error;
    });
  }

  private async currentRequestValue(manager: EntityManager, requestId: string): Promise<Record<string, unknown>> {
    const rows = await manager.query(
      `SELECT id,status,version,region_code,campaign_id,priority,priority_basis,verification_revision,canonical_request_id
         FROM assistance_request WHERE id=$1`, [requestId],
    ) as Array<Record<string, unknown>>;
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return { ...rows[0], version: Number(rows[0].version) };
  }

  private async insertEvent(
    manager: EntityManager, requestId: string, actorUserId: string | null, eventType: string, visibility: 'REPORTER' | 'STAFF',
    fromStatus: string | null, toStatus: string | null, reason: string | null, payload: Record<string, unknown>,
  ): Promise<string> {
    const rows = await manager.query(
      `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,reason,payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING id`,
      [requestId, actorUserId, eventType, visibility, fromStatus, toStatus, reason, JSON.stringify(payload)],
    ) as Array<{ id: string }>;
    if (!rows[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
    return rows[0].id;
  }

  private async notifyReporter(
    manager: EntityManager, recipientId: string | null, requestId: string, version: number, type: string, textCode: string,
  ): Promise<void> {
    if (!recipientId) return;
    await manager.query(
      `INSERT INTO notice (recipient_user_id,source_id,source_version,notice_type,payload)
       VALUES ($1,$2,$3,$4,jsonb_build_object('text_code',$5::text,'request_id',$2)) ON CONFLICT DO NOTHING`,
      [recipientId, requestId, version, type, textCode],
    );
  }

  private async hasPendingSupplement(manager: EntityManager, requestId: string): Promise<boolean> {
    const rows = await manager.query(
      `SELECT 1 FROM request_event supplement
        WHERE supplement.request_id=$1 AND supplement.event_type='REPORTER_SUPPLEMENT'
          AND supplement.payload->>'pending_review'='true'
          AND NOT EXISTS (
            SELECT 1 FROM request_event review WHERE review.request_id=supplement.request_id
              AND review.event_type='SUPPLEMENT_REVIEW' AND review.payload->>'reviewed_event_id'=supplement.id::text
          ) LIMIT 1`, [requestId],
    ) as unknown[];
    return rows.length > 0;
  }

  private async validConcurrence(
    manager: EntityManager, row: OperationRequestRow, eventId: string, reviewerId: string,
    currentGrants: RequestCoordinatorGrant[],
  ): Promise<{ actor_user_id: string }> {
    const rows = await manager.query(
      `SELECT actor_user_id,payload FROM request_event WHERE id=$1 AND request_id=$2 AND event_type='CONCURRENCE'`, [eventId, row.id],
    ) as Array<{ actor_user_id: string | null; payload: Record<string, unknown> | null }>;
    const event = rows[0];
    const payload = asObject(event?.payload);
    if (!event?.actor_user_id || event.actor_user_id === reviewerId ||
        !Object.hasOwn(payload, 'material_fact_event_id') ||
        payload.material_fact_event_id !== await this.latestMaterialFactEventId(manager, row.id)) {
      throw new AppError('SECOND_COORDINATOR_REQUIRED', { status: 409 });
    }
    if (!currentGrants.some((grant) => grant.role_code === 'COORDINATOR' && grant.user_id === event.actor_user_id && grantCovers(grant, row))) {
      throw new AppError('SECOND_COORDINATOR_REQUIRED', { status: 409 });
    }
    return { actor_user_id: event.actor_user_id };
  }

  private async latestMaterialFactEventId(manager: EntityManager, requestId: string): Promise<string | null> {
    const rows = await manager.query(
      `SELECT id FROM request_event
        WHERE request_id=$1 AND event_type='REPORTER_SUPPLEMENT'
          AND (payload->'reported_facts' ? 'location' OR payload->'reported_facts' ? 'people_affected' OR
               payload->'reported_facts' ? 'reporter_declared_danger')
        ORDER BY (payload #>> '{result,version}')::int DESC NULLS LAST,id DESC LIMIT 1`, [requestId],
    ) as Array<{ id: string }>;
    return rows[0]?.id ?? null;
  }

  private serializeSourceRefs(refs: VerifyRequestDto['source_refs'] | SupplementReviewDto['source_refs']): Record<string, string[]> {
    return {
      contact_attempt_ids: refs?.contact_attempt_ids ?? [],
      evidence_ids: refs?.evidence_ids ?? [],
      request_ids: refs?.request_ids ?? [],
    };
  }

  private async validateSourceRefs(
    manager: EntityManager, row: OperationRequestRow, refs: VerifyRequestDto['source_refs'] | SupplementReviewDto['source_refs'] | undefined,
    session: ReporterSession,
  ): Promise<ValidatedSourceRefs> {
    const attemptIds = refs?.contact_attempt_ids ?? [];
    const evidenceIds = refs?.evidence_ids ?? [];
    const requestIds = refs?.request_ids ?? [];
    const attempts = attemptIds.length ? await manager.query(
      'SELECT id,outcome FROM contact_attempt WHERE request_id=$1 AND id=ANY($2::uuid[])', [row.id, attemptIds],
    ) as Array<{ id: string; outcome: string }> : [];
    if (attempts.length !== attemptIds.length) throw new AppError('VERIFICATION_BASIS_REQUIRED', { status: 400 });
    const evidenceRows = evidenceIds.length ? await manager.query(
      `SELECT id,uploader_user_id,upload_source_ip_hash FROM evidence_metadata
        WHERE request_id=$1 AND state='READY' AND id=ANY($2::uuid[])`, [row.id, evidenceIds],
    ) as Array<{ id: string; uploader_user_id: string | null; upload_source_ip_hash: string | null }> : [];
    if (evidenceRows.length !== evidenceIds.length) throw new AppError('VERIFICATION_BASIS_REQUIRED', { status: 400 });
    const requests: ValidatedSourceRefs['requests'] = [];
    if (requestIds.length) {
      const values: unknown[] = [row.id, requestIds];
      const scope = scopeSql(session.grants, 'REQUEST_VERIFY', values, 'candidate');
      const candidates = await manager.query(
        `SELECT candidate.id,candidate.reporter_user_id,candidate.reporter_contact_phone,candidate.source_ip_hash,
                target.reporter_user_id AS target_user_id,target.reporter_contact_phone AS target_phone,
                target.source_ip_hash AS target_ip
           FROM assistance_request target JOIN request_subject target_subject ON target_subject.request_id=target.id
           JOIN assistance_request candidate ON candidate.id=ANY($2::uuid[])
           JOIN request_subject candidate_subject ON candidate_subject.request_id=candidate.id
          WHERE target.id=$1 AND candidate.id<>target.id
            AND candidate.incident_category_code=target.incident_category_code
            AND candidate.received_at BETWEEN target.received_at-interval '24 hours' AND target.received_at+interval '24 hours'
            AND ST_DWithin(target_subject.location,candidate_subject.location,1000) AND ${scope}`,
        values,
      ) as Array<{ id: string; reporter_user_id: string | null; reporter_contact_phone: string | null; source_ip_hash: string | null; target_user_id: string | null; target_phone: string | null; target_ip: string | null }>;
      if (candidates.length !== requestIds.length) throw new AppError('VERIFICATION_BASIS_REQUIRED', { status: 400 });
      for (const candidate of candidates) {
        const independent = !(candidate.target_user_id && candidate.reporter_user_id === candidate.target_user_id) &&
          !(candidate.target_phone && candidate.reporter_contact_phone === candidate.target_phone) &&
          !(candidate.target_ip && candidate.source_ip_hash === candidate.target_ip);
        requests.push({ id: candidate.id, independent });
      }
    }
    const evidence = evidenceRows.map((item) => ({
      ...item,
      independent: !(row.reporter_user_id && item.uploader_user_id === row.reporter_user_id) &&
        !(row.source_ip_hash && item.upload_source_ip_hash === row.source_ip_hash),
    }));
    return {
      attempts,
      evidence,
      requests,
      independent: requests.some((item) => item.independent) || evidence.some((item) => item.independent),
    };
  }

  private async approvedFacts(
    manager: EntityManager, requestId: string, reported?: Record<string, unknown>, regionOverride?: string | null,
  ): Promise<Record<string, unknown>> {
    const rows = await manager.query(
      `SELECT r.report_mode,r.description,r.reporter_name,r.reporter_contact_phone,r.reporter_declared_danger,
              r.region_code,r.campaign_id,r.incident_category_code,s.people_affected,s.location_source,
              s.location_accuracy_m,s.location_captured_at,ST_X(s.location::geometry) AS longitude,
              ST_Y(s.location::geometry) AS latitude,s.reporter_relationship,s.beneficiary_contact_phone,
              s.alternate_contact_name,s.alternate_contact_phone,s.information_source,s.last_known_situation_at,
              s.contactability,s.household_reference_note
         FROM assistance_request r JOIN request_subject s ON s.request_id=r.id WHERE r.id=$1`, [requestId],
    ) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const facts: Record<string, unknown> = {
      report_mode: row.report_mode, incident_category_code: row.incident_category_code,
      description: row.description, reporter_name: row.reporter_name, reporter_contact_phone: row.reporter_contact_phone,
      reporter_declared_danger: row.reporter_declared_danger, region_code: regionOverride === undefined ? row.region_code : regionOverride,
      campaign_id: row.campaign_id, people_affected: row.people_affected,
      location: { type: 'Point', coordinates: [Number(row.longitude), Number(row.latitude)], source: row.location_source,
        accuracy_m: row.location_accuracy_m, captured_at: row.location_captured_at == null ? null : toIso(row.location_captured_at as Date | string) },
      reporter_relationship: row.reporter_relationship, beneficiary_contact_phone: row.beneficiary_contact_phone,
      alternate_contact: { name: row.alternate_contact_name, phone: row.alternate_contact_phone },
      information_source: row.information_source,
      last_known_situation_at: row.last_known_situation_at == null ? null : toIso(row.last_known_situation_at as Date | string),
      contactability: row.contactability, household_reference_note: row.household_reference_note,
    };
    if (reported) {
      for (const field of ['description', 'reporter_declared_danger', 'people_affected', 'household_reference_note']) {
        if (Object.hasOwn(reported, field)) facts[field] = reported[field];
      }
      if (reported.location !== undefined) facts.location = reported.location;
    }
    return facts;
  }

  private async applySupplementFacts(manager: EntityManager, requestId: string, reported: Record<string, unknown>): Promise<void> {
    const location = asObject(reported.location);
    const coordinates = Array.isArray(location.coordinates) ? location.coordinates : [];
    const [longitude, latitude] = coordinates;
    await manager.query(
      `UPDATE request_subject SET
         people_affected=CASE WHEN $2::boolean THEN $3::integer ELSE people_affected END,
         household_reference_note=CASE WHEN $4::boolean THEN $5::text ELSE household_reference_note END,
         location=CASE WHEN $6::boolean THEN ST_SetSRID(ST_MakePoint($7::float8,$8::float8),4326)::geography ELSE location END,
         location_source=CASE WHEN $6::boolean THEN $9::text ELSE location_source END,
         location_accuracy_m=CASE WHEN $6::boolean THEN $10::numeric ELSE location_accuracy_m END,
         location_captured_at=CASE WHEN $6::boolean THEN $11::timestamptz ELSE location_captured_at END
       WHERE request_id=$1`,
      [requestId, Object.hasOwn(reported, 'people_affected'), reported.people_affected ?? null,
        Object.hasOwn(reported, 'household_reference_note'), reported.household_reference_note ?? null,
        Object.hasOwn(reported, 'location'), longitude ?? null, latitude ?? null, location.source ?? null,
        location.accuracy_m ?? null, location.captured_at ?? null],
    );
  }

  private async staffRequest(
    queryable: Pick<DataSource | EntityManager, 'query'>, requestId: string, session: ReporterSession,
    permission: Permission, lock = false,
  ): Promise<OperationRequestRow> {
    const rows = await queryable.query(
      `SELECT id,tracking_code,tracking_secret_hash,reporter_user_id,reporter_name,reporter_contact_phone,source_ip_hash,report_mode,
              status,version,review_lane,received_at,verifying_since,organization_id,region_code,campaign_id,description,
              reporter_declared_danger,priority,priority_basis,work_cycle,canonical_request_id,attribution_locked_at,incident_category_code
         FROM assistance_request WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
      [requestId],
    ) as OperationRequestRow[];
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { status: 404 });
    if (!hasPermission(session.grants, permission, { organizationId: row.organization_id, regionCode: row.region_code, campaignId: row.campaign_id })) {
      throw new AppError('FORBIDDEN', { status: 403 });
    }
    return row;
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

  private eventView(event: RequestEventRow): Record<string, unknown> {
    return { id: event.id, event_type: event.event_type, visibility: event.visibility, from_status: event.from_status,
      to_status: event.to_status, reason: event.reason, payload: event.payload, actor_user_id: event.actor_user_id, occurred_at: toIso(event.occurred_at) };
  }

  private decisionView(row: Record<string, unknown>): Record<string, unknown> {
    return { ...row, decided_at: toIso(row.decided_at as Date | string) };
  }

}
