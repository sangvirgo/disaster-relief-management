import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { canonicalRequestHash, IdempotencyService, IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { AppError } from '@c48/technical/errors/errors';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { ROLE_PERMISSIONS } from '@c48/identity-contracts/permissions';
import { hashPurposeBoundSecret } from '@c48/technical/security/secret-hash';
import { ReporterSession, ReporterSessionService } from '../requests/reporter-session';
import { RequestIntakeConfig, REQUEST_INTAKE_CONFIG } from '../requests/request-intake.service';
import { ReporterAccessService, ReporterRequestRow, trackingCodeMatches } from './reporter-access.service';
import { TrackingReadRateLimiter } from './tracking-read-rate-limiter';
import { previouslyReportedFacts, unverifiedRequestAssignments, unverifiedSubjectAssignments } from './supplement.update';
import { invalidField, supplementAllowed, validateSupplement } from './supplement.validation';
import { RecoveryIssueDto, RequestEventsQueryDto, SupplementRequestDto } from './tracking.dto';
import { RequestOperationsService } from '../operations/request-operations.service';
import { terminalStatuses, unverifiedStatuses } from '../operations/request-operations.helpers';
import { assessmentFields, enqueueAiAdvisory } from '../ai/ai-advisory-input';
import { assertRequestPermission } from '../requests/request-scope';

const recoveryCodePattern = /^[A-Za-z0-9_-]{43}$/;
const cursorFilters = (requestId: string) => ({ request_id: requestId, visibility: 'REPORTER' });

export { supplementAllowed };

export interface ReporterEventView {
  event_type: string;
  occurred_at: string;
  public_text_code: string;
}

function requestHashWithSecret(payload: unknown, secretHash: string | undefined): string {
  return canonicalRequestHash(payload, secretHash);
}

function toIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function asPlain(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return undefined;
}

function versionConflict(actual: number, expected: number): never {
  if (actual !== expected) throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: actual } });
  throw new AppError('INTERNAL_ERROR', { status: 500 });
}

function trackingClientIp(request: import('express').Request): string {
  return request.ip || request.socket?.remoteAddress || 'unknown';
}

@Injectable()
export class TrackingService {
  private readonly readRateLimiter = new TrackingReadRateLimiter();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly access: ReporterAccessService,
    private readonly sessions: ReporterSessionService,
    @Inject(REQUEST_INTAKE_CONFIG) private readonly config: RequestIntakeConfig,
    private readonly operations: RequestOperationsService,
  ) {}

  async track(
    trackingCode: string | undefined,
    trackingSecret: string | undefined,
    request: import('express').Request,
  ): Promise<Record<string, unknown>> {
    this.readRateLimiter.assertAllowed(trackingClientIp(request));
    const session = await this.sessions.optional(request, this.access.validTrackingSecret(trackingSecret));
    const row = await this.access.byTrackingCapability(trackingCode, trackingSecret, session);
    return this.trackingView(row);
  }

  async events(
    requestId: string,
    trackingCode: string | undefined,
    trackingSecret: string | undefined,
    query: RequestEventsQueryDto,
    request: import('express').Request,
  ): Promise<{ items: ReporterEventView[]; more: boolean; cursor?: string }> {
    this.readRateLimiter.assertAllowed(trackingClientIp(request));
    if (this.access.validTrackingSecret(trackingSecret)) {
      const row = await this.access.forRequest(requestId, trackingCode, trackingSecret, null);
      return this.readEvents(this.dataSource, row.id, query.cursor, query.limit ?? 50);
    }
    const session = await this.sessions.optional(request);
    if (session) {
      try {
        const row = await this.access.forRequest(requestId, trackingCode, trackingSecret, session);
        return this.readEvents(this.dataSource, row.id, query.cursor, query.limit ?? 50);
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== 'NOT_FOUND') throw error;
      }
      if (!session.grants.some((grant) => (ROLE_PERMISSIONS[grant.role_code] as readonly string[]).includes('REQUEST_DETAIL_READ'))) {
        throw new AppError('NOT_FOUND', { status: 404 });
      }
      return this.operations.events(requestId, query, request, session) as Promise<{ items: ReporterEventView[]; more: boolean; cursor?: string }>;
    }
    const row = await this.access.forRequest(requestId, trackingCode, trackingSecret, null);
    return this.readEvents(this.dataSource, row.id, query.cursor, query.limit ?? 50);
  }

  async mine(query: RequestEventsQueryDto, request: import('express').Request): Promise<{ items: Array<Record<string, unknown>>; more: boolean; cursor?: string }> {
    const session = await this.sessions.require(request);
    const filters = { reporter_user_id: session.userId };
    const cursor = query.cursor ? decodeKeysetCursor(query.cursor, filters) : undefined;
    const rows = await this.dataSource.query(
      `SELECT id, tracking_code, status, received_at,
              to_char(received_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_received_at
         FROM assistance_request
        WHERE reporter_user_id = $1
          AND ($2::timestamptz IS NULL OR (received_at, id) < ($2::timestamptz, $3::uuid))
        ORDER BY received_at DESC, id DESC LIMIT $4`,
      [session.userId, cursor?.sort[0] ?? null, cursor?.id ?? null, (query.limit ?? 50) + 1],
    ) as Array<{ id: string; tracking_code: string; status: string; received_at: Date | string; cursor_received_at: string }>;
    const more = rows.length > (query.limit ?? 50);
    const page = rows.slice(0, query.limit ?? 50);
    const items = page.map((row) => ({ id: row.id, tracking_code: row.tracking_code, status: row.status, received_at: toIso(row.received_at) }));
    const next = more && page.length ? page[page.length - 1]! : undefined;
    return { items, more, ...(next ? { cursor: encodeKeysetCursor([next.cursor_received_at], next.id, filters) } : {}) };
  }

  async supplement(
    requestId: string,
    dto: SupplementRequestDto,
    key: string,
    trackingCode: string | undefined,
    trackingSecret: string | undefined,
    request: import('express').Request,
    mode: 'SUPPLEMENT' | 'PUT' = 'SUPPLEMENT',
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    validateSupplement(dto);
    const hasTrackingCapability = this.access.validTrackingSecret(trackingSecret);
    const session = await this.sessions.optional(request, hasTrackingCapability);
    const secretHash = hasTrackingCapability ? this.access.trackingSecretHash(trackingSecret!) : undefined;
    const scope = session ? `user:${session.userId}` : `guest:${requestId}`;
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.requests.supplement:${scope}`,
      command: mode === 'PUT' ? 'response.requests.report.update' : 'response.requests.supplement',
      key,
      requestHash: requestHashWithSecret({ request_id: requestId, session_user_id: session?.userId ?? null, dto }, secretHash),
      execute: async (manager) => {
        const row = await this.access.forRequest(requestId, trackingCode, trackingSecret, session, manager, true);
        if (!supplementAllowed(row.status, row.review_lane)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (Number(row.version) !== dto.expected_version) versionConflict(Number(row.version), dto.expected_version);
        const subjectRows = await manager.query(
          `SELECT people_affected,children_count,elderly_count,household_reference_note,location_source,location_accuracy_m,location_captured_at,
                  ST_X(location::geometry) AS longitude, ST_Y(location::geometry) AS latitude
             FROM request_subject WHERE request_id = $1`,
          [row.id],
        ) as Array<Record<string, unknown>>;
        const before = subjectRows[0];
        if (!before) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const verified = !unverifiedStatuses.has(row.status);
        const nextNeedsRescue = dto.needs_rescue ?? row.needs_rescue;
        const nextNeedsRelief = dto.needs_relief_supplies ?? row.needs_relief_supplies;
        if (!nextNeedsRescue && !nextNeedsRelief) throw invalidField('needs_rescue', 'AT_LEAST_ONE_NEED_REQUIRED');
        const nextPeople = Object.hasOwn(dto, 'people_affected') ? dto.people_affected ?? null : before.people_affected as number | null;
        const nextChildren = Object.hasOwn(dto, 'children_count') ? dto.children_count ?? null : before.children_count as number | null;
        const nextElderly = Object.hasOwn(dto, 'elderly_count') ? dto.elderly_count ?? null : before.elderly_count as number | null;
        if (nextPeople != null && (nextChildren ?? 0) + (nextElderly ?? 0) > nextPeople) throw invalidField('children_count', 'VULNERABLE_COUNT_EXCEEDS_TOTAL');
        const previouslyReported = previouslyReportedFacts(dto, row, before);
        const regionRows = dto.location && !verified
          ? await manager.query(
            `SELECT min(region_code) AS region_code FROM region_boundary
              WHERE ST_Covers(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326))
              HAVING count(*) = 1`,
            dto.location.coordinates,
          ) as Array<{ region_code: string }>
          : [];
        const payload: Record<string, unknown> = {
          public_text_code: 'SUPPLEMENT_RECEIVED',
          reported_facts: dto,
          previously_reported: previouslyReported,
          pending_review: verified,
          danger_alert_raised: dto.reporter_declared_danger === true && !row.reporter_declared_danger,
        };
        const requestChange = verified
          ? { sets: [] as string[], values: [row.id, dto.expected_version] as unknown[] }
          : unverifiedRequestAssignments(dto, mode, row.id, regionRows[0]?.region_code ?? null);
        requestChange.sets.push('version=version+1');
        const [requestUpdates] = await manager.query(
          `UPDATE assistance_request SET ${requestChange.sets.join(',')} WHERE id=$1 AND version=$2 RETURNING status,version,tracking_code`,
          requestChange.values,
        ) as [Array<{ status: string; version: number; tracking_code: string }>, number];
        const updated = requestUpdates[0];
        if (!updated) versionConflict(Number(row.version), dto.expected_version);
        if (!verified) {
          const { sets, values } = unverifiedSubjectAssignments(dto, row.id);
          if (sets.length) await manager.query(`UPDATE request_subject SET ${sets.join(', ')} WHERE request_id = $1`, values);
          if (assessmentFields.some((field) => Object.hasOwn(dto, field))) await enqueueAiAdvisory(manager, row.id);
        }
        const value = { id: row.id, tracking_code: updated.tracking_code, status: updated.status, version: Number(updated.version) };
        payload.result = value;
        const eventRows = await manager.query(
          `INSERT INTO request_event (request_id, actor_user_id, event_type, visibility, from_status, to_status, payload)
           VALUES ($1,$2,'REPORTER_SUPPLEMENT','REPORTER',$3,$3,$4::jsonb) RETURNING id`,
          [row.id, session?.userId ?? null, row.status, JSON.stringify(payload)],
        ) as Array<{ id: string }>;
        const event = eventRows[0];
        if (!event) throw new AppError('INTERNAL_ERROR', { status: 500 });
        return { status: 201, value, resource: { type: 'request_event', id: event.id } };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'request_event') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const rows = await manager.query("SELECT payload->'result' AS result FROM request_event WHERE id=$1", [resource.id]) as Array<{ result: unknown }>;
        const value = asPlain(rows[0]?.result);
        if (!value) throw new AppError('INTERNAL_ERROR', { status: 500 });
        return value;
      },
    });
  }

  async claim(
    dto: { tracking_code: string },
    key: string,
    trackingSecret: string | undefined,
    request: import('express').Request,
  ): Promise<IdempotentResult<{ id: string; tracking_code: string }>> {
    const session = await this.sessions.require(request);
    if (!this.access.validTrackingSecret(trackingSecret)) throw new AppError('NOT_FOUND', { status: 404 });
    const secretHash = this.access.trackingSecretHash(trackingSecret!);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'response.requests.claim',
      key,
      requestHash: requestHashWithSecret({ tracking_code: dto.tracking_code, user_id: session.userId }, secretHash),
      execute: async (manager) => {
        const rows = await manager.query(
          `SELECT id, tracking_code, tracking_secret_hash, reporter_user_id, version
             FROM assistance_request WHERE tracking_secret_hash=$1 FOR UPDATE`, [secretHash],
        ) as Array<{ id: string; tracking_code: string; tracking_secret_hash: string | null; reporter_user_id: string | null; version: number }>;
        const row = rows[0];
        const codeMatches = trackingCodeMatches(row?.tracking_code ?? '0000000000', dto.tracking_code);
        if (!row || !codeMatches || !row.tracking_secret_hash) throw new AppError('NOT_FOUND', { status: 404 });
        const secretMatches = this.access.validTrackingSecret(trackingSecret) && row.tracking_secret_hash === secretHash;
        if (!secretMatches) throw new AppError('NOT_FOUND', { status: 404 });
        if (row.reporter_user_id) throw new AppError('ALREADY_CLAIMED', { status: 409 });
        const [changedRows] = await manager.query(
          `UPDATE assistance_request SET reporter_user_id=$2, tracking_secret_hash=NULL, version=version+1
            WHERE id=$1 AND reporter_user_id IS NULL AND version=$3 RETURNING id, tracking_code`,
          [row.id, session.userId, row.version],
        ) as [Array<{ id: string; tracking_code: string }>, number];
        const value = changedRows[0];
        if (!value) versionConflict(Number(row.version), Number(row.version));
        await manager.query(
          `INSERT INTO request_event (request_id, actor_user_id, event_type, visibility, payload)
           VALUES ($1,$2,'REQUEST_CLAIMED','STAFF','{}')`, [row.id, session.userId],
        );
        return { status: 200, value, resource: { type: 'assistance_request', id: value.id } };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'assistance_request') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const rows = await manager.query('SELECT id, tracking_code, reporter_user_id FROM assistance_request WHERE id=$1', [resource.id]) as Array<{ id: string; tracking_code: string; reporter_user_id: string | null }>;
        if (!rows[0] || rows[0].reporter_user_id !== session.userId) throw new AppError('NOT_FOUND', { status: 404 });
        return { id: rows[0].id, tracking_code: rows[0].tracking_code };
      },
    });
  }

  async revokeSecret(
    requestId: string,
    dto: { expected_version: number },
    key: string,
    request: import('express').Request,
  ): Promise<IdempotentResult<{ id: string; tracking_secret_revoked: true }>> {
    const session = await this.sessions.require(request);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'response.requests.tracking-secret.revoke',
      key,
      requestHash: canonicalRequestHash({ request_id: requestId, dto, user_id: session.userId }),
      execute: async (manager) => {
        const row = await this.staffRequest(manager, requestId, session, true);
        if (Number(row.version) !== dto.expected_version) versionConflict(Number(row.version), dto.expected_version);
        if (row.tracking_secret_hash) {
          await manager.query('UPDATE assistance_request SET tracking_secret_hash=NULL, version=version+1 WHERE id=$1 AND version=$2', [row.id, dto.expected_version]);
          await manager.query(
            `INSERT INTO request_event (request_id, actor_user_id, event_type, visibility, payload)
             VALUES ($1,$2,'TRACKING_SECRET_REVOKED','STAFF','{}')`, [row.id, session.userId],
          );
        }
        return { status: 200, value: { id: row.id, tracking_secret_revoked: true }, resource: null };
      },
      replay: async (manager) => {
        await this.staffRequest(manager, requestId, session, false);
        return { id: requestId, tracking_secret_revoked: true };
      },
    });
  }

  async issueRecovery(
    requestId: string,
    dto: RecoveryIssueDto,
    key: string,
    request: import('express').Request,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'response.requests.recovery.issue',
      key,
      requestHash: canonicalRequestHash({ request_id: requestId, dto, user_id: session.userId }),
      execute: async (manager) => {
        const row = await this.staffRequest(manager, requestId, session, true);
        if (Number(row.version) !== dto.expected_version) versionConflict(Number(row.version), dto.expected_version);
        if (row.reporter_user_id || terminalStatuses.has(row.status)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const attempts = await manager.query(
          `SELECT id FROM contact_attempt
            WHERE id=$1 AND request_id=$2 AND actor_user_id<>$3 AND contact_target='REPORTER' AND outcome='REACHED'`,
          [dto.contact_attempt_id, requestId, session.userId],
        ) as unknown[];
        if (attempts.length === 0) throw new AppError('NO_CONTACT_ATTEMPT', { status: 409 });
        const rawCode = randomBytes(32).toString('base64url');
        const codeHash = hashPurposeBoundSecret(rawCode, `sos-recovery:${requestId}`, this.config.peppers, 'v1');
        const inserted = await manager.query(
          `INSERT INTO capability_recovery (request_id,code_hash,expires_at,issued_by_user_id,basis,source_note)
           VALUES ($1,$2,clock_timestamp()+interval '30 minutes',$3,$4,$5) RETURNING id,expires_at`,
          [requestId, codeHash, session.userId, dto.reason, dto.source_note ?? null],
        ) as Array<{ id: string; expires_at: Date | string }>;
        const issuance = inserted[0];
        if (!issuance) throw new AppError('INTERNAL_ERROR', { status: 500 });
        await manager.query(
          `UPDATE capability_recovery SET consumed_at=now(), consumed_by_user_id=$2
            WHERE request_id=$1 AND id<>$3 AND consumed_at IS NULL`, [requestId, session.userId, issuance.id],
        );
        await manager.query('UPDATE assistance_request SET version=version+1 WHERE id=$1 AND version=$2', [requestId, dto.expected_version]);
        await manager.query(
          `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,reason,payload)
           VALUES ($1,$2,'TRACKING_RECOVERY_ISSUED','STAFF',$3,jsonb_build_object('issuance_id',$4::text,'contact_attempt_id',$5::text))`,
          [requestId, session.userId, dto.reason, issuance.id, dto.contact_attempt_id],
        );
        return {
          status: 201,
          value: { issuance_id: issuance.id, recovery_code: rawCode, expires_at: toIso(issuance.expires_at) },
          resource: { type: 'capability_recovery', id: issuance.id },
        };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'capability_recovery') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const rows = await manager.query('SELECT id,expires_at FROM capability_recovery WHERE id=$1', [resource.id]) as Array<{ id: string; expires_at: Date | string }>;
        const issuance = rows[0];
        if (!issuance) throw new AppError('NOT_FOUND', { status: 404 });
        return { issuance_id: issuance.id, expires_at: toIso(issuance.expires_at) };
      },
    });
  }

  async recover(
    dto: { tracking_code: string },
    key: string,
    recoveryCode: string | undefined,
    request: import('express').Request,
  ): Promise<IdempotentResult<{ id: string; tracking_code: string }>> {
    const session = await this.sessions.require(request);
    if (!recoveryCode || !recoveryCodePattern.test(recoveryCode) || Buffer.from(recoveryCode, 'base64url').length !== 32) {
      throw new AppError('NOT_FOUND', { status: 404 });
    }
    const codeBinding = hashPurposeBoundSecret(recoveryCode, 'sos-recovery-idempotency', this.config.peppers, 'v1');
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `user:${session.userId}`,
      command: 'response.requests.recovery.redeem',
      key,
      requestHash: requestHashWithSecret({ tracking_code: dto.tracking_code, user_id: session.userId }, codeBinding),
      execute: async (manager) => {
        const rows = await manager.query(
          `SELECT id,tracking_code,reporter_user_id,version FROM assistance_request
            WHERE tracking_code=$1 FOR UPDATE`, [dto.tracking_code],
        ) as Array<{ id: string; tracking_code: string; reporter_user_id: string | null; version: number }>;
        const row = rows[0];
        const codeMatches = trackingCodeMatches(row?.tracking_code ?? '0000000000', dto.tracking_code);
        if (!row || !codeMatches || row.reporter_user_id) throw new AppError('NOT_FOUND', { status: 404 });
        const storedHash = hashPurposeBoundSecret(recoveryCode, `sos-recovery:${row.id}`, this.config.peppers, 'v1');
        const codes = await manager.query(
          `SELECT id FROM capability_recovery WHERE request_id=$1 AND code_hash=$2
            AND consumed_at IS NULL AND expires_at>clock_timestamp() FOR UPDATE`, [row.id, storedHash],
        ) as Array<{ id: string }>;
        const issuance = codes[0];
        if (!issuance) throw new AppError('NOT_FOUND', { status: 404 });
        const [consumedRows] = await manager.query(
          `UPDATE capability_recovery SET consumed_at=now(),consumed_by_user_id=$2
            WHERE id=$1 AND consumed_at IS NULL RETURNING id`, [issuance.id, session.userId],
        ) as [unknown[], number];
        if (consumedRows.length !== 1) throw new AppError('NOT_FOUND', { status: 404 });
        const [changedRows] = await manager.query(
          `UPDATE assistance_request SET reporter_user_id=$2,tracking_secret_hash=NULL,version=version+1
            WHERE id=$1 AND reporter_user_id IS NULL RETURNING id,tracking_code`, [row.id, session.userId],
        ) as [Array<{ id: string; tracking_code: string }>, number];
        const value = changedRows[0];
        if (!value) throw new AppError('NOT_FOUND', { status: 404 });
        await manager.query(
          `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,payload)
           VALUES ($1,$2,'REQUEST_RECOVERED','STAFF',jsonb_build_object('issuance_id',$3::text))`, [row.id, session.userId, issuance.id],
        );
        return { status: 200, value, resource: { type: 'assistance_request', id: row.id } };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'assistance_request') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const rows = await manager.query('SELECT id,tracking_code,reporter_user_id FROM assistance_request WHERE id=$1', [resource.id]) as Array<{ id: string; tracking_code: string; reporter_user_id: string | null }>;
        if (!rows[0] || rows[0].reporter_user_id !== session.userId) throw new AppError('NOT_FOUND', { status: 404 });
        return { id: rows[0].id, tracking_code: rows[0].tracking_code };
      },
    });
  }

  private async trackingView(row: ReporterRequestRow): Promise<Record<string, unknown>> {
    const timeline = await this.readEvents(this.dataSource, row.id, undefined, 50);
    const extra = await this.dataSource.query(
      `SELECT decision.reason AS rejection_reason, canonical.tracking_code AS duplicate_of_code
         FROM assistance_request r
         LEFT JOIN LATERAL (
           SELECT reason FROM verification_decision WHERE request_id=r.id ORDER BY decided_at DESC,id DESC LIMIT 1
         ) decision ON true
         LEFT JOIN assistance_request canonical ON canonical.id=r.canonical_request_id
        WHERE r.id=$1`, [row.id],
    ) as Array<{ rejection_reason: string | null; duplicate_of_code: string | null }>;
    return {
      id: row.id,
      tracking_code: row.tracking_code,
      status: row.status,
      version: Number(row.version),
      priority_visible: false,
      received_at: toIso(row.received_at),
      timeline: timeline.items,
      more: timeline.more,
      ...(timeline.cursor ? { cursor: timeline.cursor } : {}),
      ...(row.status === 'REJECTED' && extra[0]?.rejection_reason ? { rejection_reason: extra[0].rejection_reason } : {}),
      ...(row.status === 'DUPLICATE' && extra[0]?.duplicate_of_code ? { duplicate_of_code: extra[0].duplicate_of_code } : {}),
      can_supplement: supplementAllowed(row.status, row.review_lane),
    };
  }

  private async readEvents(
    queryable: Pick<DataSource | EntityManager, 'query'>,
    requestId: string,
    rawCursor: string | undefined,
    limit: number,
  ): Promise<{ items: ReporterEventView[]; more: boolean; cursor?: string }> {
    const filters = cursorFilters(requestId);
    const cursor = rawCursor ? decodeKeysetCursor(rawCursor, filters) : undefined;
    const rows = await queryable.query(
      `SELECT id,event_type,occurred_at,
              to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_occurred_at,
              coalesce(payload->>'public_text_code',event_type) AS public_text_code
         FROM request_event WHERE request_id=$1 AND visibility='REPORTER'
           AND ($2::timestamptz IS NULL OR (occurred_at,id)<($2::timestamptz,$3::uuid))
        ORDER BY occurred_at DESC,id DESC LIMIT $4`,
      [requestId, cursor?.sort[0] ?? null, cursor?.id ?? null, limit + 1],
    ) as Array<{ id: string; event_type: string; occurred_at: Date | string; cursor_occurred_at: string; public_text_code: string }>;
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    const items = page.map((row) => ({ event_type: row.event_type, occurred_at: toIso(row.occurred_at), public_text_code: row.public_text_code }));
    const next = more && page.length ? page[page.length - 1]! : undefined;
    return { items, more, ...(next ? { cursor: encodeKeysetCursor([next.cursor_occurred_at], next.id, filters) } : {}) };
  }

  private async staffRequest(manager: EntityManager, requestId: string, session: ReporterSession, lock: boolean): Promise<ReporterRequestRow> {
    const rows = await manager.query(
      `SELECT id,tracking_code,tracking_secret_hash,reporter_user_id,status,version,review_lane,received_at,
              organization_id,region_code,campaign_id,description,reporter_declared_danger
         FROM assistance_request WHERE id=$1${lock ? ' FOR UPDATE' : ''}`,
      [requestId],
    ) as ReporterRequestRow[];
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { status: 404 });
    assertRequestPermission(session, 'REQUEST_VERIFY', row);
    return row;
  }
}
