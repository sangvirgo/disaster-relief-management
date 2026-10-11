import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors';
import type { IdempotentResult } from '../../../../packages/technical/src/idempotency';
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
import { RequestOperationsPersistenceService } from './request-operations.persistence.service';
import { RequestOperationsCommandRunner } from './request-operations.command-runner.service';
import { RequestOperationsQueriesService } from './request-operations.queries.service';
import { RequestOperationsTriageService } from './request-operations.triage.service';

@Injectable()
export class RequestOperationsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ReporterSessionService,
    @Inject(REQUEST_OPERATIONS_CONFIG) private readonly config: RequestOperationsConfig,
    private readonly queries: RequestOperationsQueriesService,
    private readonly persistence: RequestOperationsPersistenceService,
    private readonly commandRunner: RequestOperationsCommandRunner,
    private readonly triageService: RequestOperationsTriageService,
  ) {}

  static config(): RequestOperationsConfig { return loadOperationsConfig(); }

  async queue(query: RequestQueueQueryDto, request: Request): Promise<Record<string, unknown>> {
    return this.queries.queue(query, request);
  }

  async unassigned(query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    return this.queries.unassigned(query, request);
  }

  async detail(requestId: string, request: Request): Promise<Record<string, unknown>> {
    return this.queries.detail(requestId, request);
  }

  async events(requestId: string, query: RequestOperationPageDto, request: Request, sessionOverride?: ReporterSession): Promise<Record<string, unknown>> {
    return this.queries.events(requestId, query, request, sessionOverride);
  }

  async contactAttempts(requestId: string, query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    return this.queries.contactAttempts(requestId, query, request);
  }

  async duplicates(requestId: string, query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    return this.queries.duplicates(requestId, query, request);
  }

  async evidence(requestId: string, query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    return this.queries.evidence(requestId, query, request);
  }

  async missions(requestId: string, query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    return this.queries.missions(requestId, query, request);
  }

  async duplicateCandidates(requestId: string, request: Request): Promise<Record<string, unknown>> {
    return this.queries.duplicateCandidates(requestId, request);
  }

  async verificationCandidates(requestId: string, request: Request): Promise<Record<string, unknown>> {
    return this.queries.verificationCandidates(requestId, request);
  }

  async startVerification(requestId: string, dto: RequestVersionDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.start-verification', dto,
      async (manager) => {
        const row = await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY', true);
        checkVersion(Number(row.version), dto.expected_version);
        if (row.status !== 'SUBMITTED') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const [updated] = await manager.query(
          `UPDATE assistance_request SET status='VERIFYING',verifying_since=clock_timestamp(),version=version+1
            WHERE id=$1 AND version=$2 RETURNING id,status,version,verifying_since`,
          [row.id, dto.expected_version],
        ) as [Array<{ id: string; status: string; version: number; verifying_since: Date | string }>, number];
        if (!updated[0]) checkVersion(Number(row.version), dto.expected_version);
        await this.persistence.insertEvent(manager, row.id, session.userId, 'VERIFICATION_STARTED', 'REPORTER', row.status, 'VERIFYING', null, { public_text_code: 'REQUEST_VERIFYING' });
        await this.persistence.notifyReporter(manager, row.reporter_user_id, row.id, Number(updated[0]!.version), 'REQUEST_STATUS_CHANGED', 'REQUEST_VERIFYING');
        const value = { id: row.id, status: updated[0]!.status, version: Number(updated[0]!.version), verifying_since: toIso(updated[0]!.verifying_since) };
        return { status: 200, value, resource: { type: 'assistance_request', id: row.id } };
      },
      (manager) => this.persistence.currentRequestValue(manager, requestId),
    );
  }

  async addContactAttempt(requestId: string, dto: ContactAttemptDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const note = cleanText(dto.note ?? undefined);
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.contact-attempt', dto,
      async (manager) => {
        const row = await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY', true);
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
        await this.persistence.insertEvent(manager, row.id, session.userId, 'CONTACT_ATTEMPT_RECORDED', 'STAFF', row.status, row.status, null, {
          contact_attempt_id: attempt.id, outcome: dto.outcome, contact_target: dto.contact_target,
        });
        return {
          status: 201,
          value: { id: attempt.id, contact_target: attempt.contact_target, outcome: attempt.outcome, note: attempt.note, actor_user_id: attempt.actor_user_id, attempted_at: toIso(attempt.attempted_at), version: Number(updated[0]?.version) },
          resource: { type: 'contact_attempt', id: attempt.id },
        };
      },
      async (manager, resource) => {
        await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY');
        const rows = await manager.query('SELECT id,contact_target,outcome,note,actor_user_id,attempted_at FROM contact_attempt WHERE id=$1 AND request_id=$2', [resource?.id, requestId]) as Array<Record<string, unknown> & { id: string; attempted_at: Date | string }>;
        const attempt = rows[0];
        if (!attempt) throw new AppError('NOT_FOUND', { status: 404 });
        const current = await this.persistence.currentRequestValue(manager, requestId);
        return { ...attempt, attempted_at: toIso(attempt.attempted_at), version: current.version };
      },
    );
  }

  async verify(requestId: string, dto: VerifyRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const reason = cleanText(dto.reason ?? undefined);
    const sourceNote = cleanText(dto.source_note ?? undefined);
    const currentCoordinators = dto.basis === 'TWO_COORDINATOR_JUDGMENT'
      ? await this.sessions.requestCoordinatorGrants((await this.persistence.staffRequest(this.dataSource, requestId, session, 'REQUEST_VERIFY')).organization_id)
      : undefined;
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.verify', dto,
      async (manager) => {
        const row = await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY', true);
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
        const eventId = await this.persistence.insertEvent(manager, row.id, session.userId, 'REQUEST_VERIFIED', 'REPORTER', row.status, 'VERIFIED', reason, {
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
        await this.persistence.notifyReporter(manager, row.reporter_user_id, row.id, Number(updated[0]!.version), 'REQUEST_STATUS_CHANGED', 'REQUEST_VERIFIED');
        return { status: 200, value: { id: row.id, status: updated[0]!.status, version: Number(updated[0]!.version), verification_revision: updated[0]!.verification_revision, decision_id: decision.id }, resource: { type: 'verification_decision', id: decision.id } };
      },
      async (manager, resource) => {
        await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY');
        const rows = await manager.query('SELECT id FROM verification_decision WHERE id=$1 AND request_id=$2', [resource?.id, requestId]) as Array<{ id: string }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        const current = await this.persistence.currentRequestValue(manager, requestId);
        return { ...current, decision_id: rows[0].id };
      },
    );
  }

  async concur(requestId: string, dto: ConcurRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const note = cleanText(dto.note, true);
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.concur', dto,
      async (manager) => {
        const row = await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY', true);
        checkVersion(Number(row.version), dto.expected_version);
        if (row.status !== 'VERIFYING') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const startedBy = await manager.query(
          `SELECT actor_user_id FROM request_event WHERE request_id=$1 AND event_type='VERIFICATION_STARTED' ORDER BY occurred_at,id LIMIT 1`, [row.id],
        ) as Array<{ actor_user_id: string | null }>;
        if (startedBy[0]?.actor_user_id === session.userId) throw new AppError('SECOND_COORDINATOR_REQUIRED', { status: 409 });
        const materialFactEventId = await this.latestMaterialFactEventId(manager, row.id);
        const resultingVersion = Number(row.version) + 1;
        const eventId = await this.persistence.insertEvent(manager, row.id, session.userId, 'CONCURRENCE', 'STAFF', row.status, row.status, note, {
          reviewed_version: Number(row.version), resulting_version: resultingVersion, material_fact_event_id: materialFactEventId,
        });
        const [updated] = await manager.query('UPDATE assistance_request SET version=version+1 WHERE id=$1 AND version=$2 RETURNING version', [row.id, dto.expected_version]) as [Array<{ version: number }>, number];
        if (!updated[0]) checkVersion(Number(row.version), dto.expected_version);
        return { status: 200, value: { id: row.id, status: row.status, version: Number(updated[0]!.version), event_id: eventId }, resource: { type: 'request_event', id: eventId } };
      },
      async (manager, resource) => {
        await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY');
        const rows = await manager.query('SELECT id FROM request_event WHERE id=$1 AND request_id=$2 AND event_type=\'CONCURRENCE\'', [resource?.id, requestId]) as Array<{ id: string }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        const current = await this.persistence.currentRequestValue(manager, requestId);
        return { ...current, event_id: rows[0].id };
      },
    );
  }

  async reject(requestId: string, dto: RejectRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const reason = cleanText(dto.reason, true)!;
    const reasonKind = dto.reason_kind ?? 'OTHER';
    await this.persistence.staffRequest(this.dataSource, requestId, session, 'REQUEST_VERIFY');
    const knownChildren = await this.dataSource.query(
      'SELECT id,organization_id FROM assistance_request WHERE canonical_request_id=$1 ORDER BY id', [requestId],
    ) as Array<{ id: string; organization_id: string }>;
    const coordinatorGrants = new Map<string, RequestCoordinatorGrant[]>();
    for (const organizationId of new Set(knownChildren.map((child) => child.organization_id))) {
      coordinatorGrants.set(organizationId, await this.sessions.requestCoordinatorGrants(organizationId));
    }
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.reject', dto,
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
        const eventId = await this.persistence.insertEvent(manager, row.id, session.userId, 'REQUEST_REJECTED', 'REPORTER', row.status, 'REJECTED', reason, {
          public_text_code: 'REQUEST_REJECTED', decision_id: decision.id, reason_kind: reasonKind,
        });
        const [updated] = await manager.query(
          `UPDATE assistance_request SET status='REJECTED',version=version+1
            WHERE id=$1 AND version=$2 RETURNING id,status,version`, [row.id, dto.expected_version],
        ) as [Array<{ id: string; status: string; version: number }>, number];
        if (!updated[0]) checkVersion(Number(row.version), dto.expected_version);
        await this.persistence.notifyReporter(manager, row.reporter_user_id, row.id, Number(updated[0]!.version), 'REQUEST_STATUS_CHANGED', 'REQUEST_REJECTED');
        const orphaned: Array<{ id: string; status: string; version: number }> = [];
        for (const child of childRows) {
          await this.persistence.insertEvent(manager, child.id, null, 'DUPLICATE_ORPHANED', 'REPORTER', 'DUPLICATE', 'VERIFYING', null, {
            public_text_code: 'DUPLICATE_ORPHANED', canonical_request_id: requestId, rejection_decision_id: decision.id,
            resulting_version: Number(child.version) + 1,
          });
          const [childUpdate] = await manager.query(
            `UPDATE assistance_request SET status='VERIFYING',canonical_request_id=NULL,verifying_since=clock_timestamp(),version=version+1
              WHERE id=$1 AND status='DUPLICATE' AND canonical_request_id=$2 RETURNING version`, [child.id, requestId],
          ) as [Array<{ version: number }>, number];
          if (!childUpdate[0]) throw new AppError('DUPLICATE_SET_CHANGED', { status: 409 });
          const version = Number(childUpdate[0].version);
          await this.persistence.notifyReporter(manager, child.reporter_user_id, child.id, version, 'REQUEST_STATUS_CHANGED', 'DUPLICATE_ORPHANED');
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
        await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY');
        const rows = await manager.query('SELECT id FROM verification_decision WHERE id=$1 AND request_id=$2 AND outcome=\'REJECTED\'', [resource?.id, requestId]) as Array<{ id: string }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        const current = await this.persistence.currentRequestValue(manager, requestId);
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
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.duplicate', dto,
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
        await this.persistence.insertEvent(manager, source.id, session.userId, 'REQUEST_DUPLICATED', 'REPORTER', source.status, 'DUPLICATE', reason, {
          public_text_code: 'REQUEST_DUPLICATED', decision_id: decision.id, canonical_request_id: canonical.id,
        });
        const [updated] = await manager.query(
          `UPDATE assistance_request SET status='DUPLICATE',canonical_request_id=$3,version=version+1
            WHERE id=$1 AND version=$2 RETURNING id,status,version,canonical_request_id`,
          [source.id, dto.expected_version, canonical.id],
        ) as [Array<{ id: string; status: string; version: number; canonical_request_id: string }>, number];
        if (!updated[0]) checkVersion(Number(source.version), dto.expected_version);
        await this.persistence.notifyReporter(manager, source.reporter_user_id, source.id, Number(updated[0]!.version), 'REQUEST_STATUS_CHANGED', 'REQUEST_DUPLICATED');
        return { status: 200, value: { id: source.id, status: updated[0]!.status, version: Number(updated[0]!.version), canonical_request_id: updated[0]!.canonical_request_id, decision_id: decision.id }, resource: { type: 'verification_decision', id: decision.id } };
      },
      async (manager, resource) => {
        await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY');
        const rows = await manager.query('SELECT id FROM verification_decision WHERE id=$1 AND request_id=$2 AND outcome=\'DUPLICATE\'', [resource?.id, requestId]) as Array<{ id: string }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        return this.persistence.currentRequestValue(manager, requestId);
      },
    );
  }

  async triage(requestId: string, dto: TriageRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.triageService.triage(requestId, dto, key, request);
  }

  async authorityReferral(requestId: string, dto: AuthorityReferralDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const referredBody = cleanText(dto.referred_body, true)!;
    const note = cleanText(dto.note, true)!;
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.authority-referral', dto,
      async (manager) => {
        const row = await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY', true);
        if (terminalStatuses.has(row.status) || row.status === 'RESOLVING') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const [updated] = await manager.query('UPDATE assistance_request SET version=version+1 WHERE id=$1 RETURNING version', [row.id]) as [Array<{ version: number }>, number];
        const eventId = await this.persistence.insertEvent(manager, row.id, session.userId, 'AUTHORITY_REFERRED', 'STAFF', row.status, row.status, note, { referred_body: referredBody });
        return { status: 201, value: { id: row.id, status: row.status, version: Number(updated[0]?.version), event_id: eventId }, resource: { type: 'request_event', id: eventId } };
      },
      async (manager, resource) => {
        await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY');
        const rows = await manager.query('SELECT id FROM request_event WHERE id=$1 AND request_id=$2 AND event_type=\'AUTHORITY_REFERRED\'', [resource?.id, requestId]) as Array<{ id: string }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        return { ...(await this.persistence.currentRequestValue(manager, requestId)), event_id: rows[0].id };
      },
    );
  }

  async correctRegion(requestId: string, dto: CorrectRegionDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const reason = cleanText(dto.reason, true)!;
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.correct-region', dto,
      async (manager) => {
        const row = await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_UNASSIGNED_QUEUE', true);
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
        await this.persistence.insertEvent(manager, row.id, session.userId, 'REGION_CORRECTED', 'STAFF', row.status, row.status, reason, { previous_region_code: row.region_code, region_code: updated[0]!.region_code });
        return { status: 200, value: { id: row.id, region_code: updated[0]!.region_code, version: Number(updated[0]!.version) }, resource: { type: 'assistance_request', id: row.id } };
      },
      (manager) => this.persistence.currentRequestValue(manager, requestId),
    );
  }

  async reviewSupplement(
    requestId: string, eventId: string, dto: SupplementReviewDto, key: string, request: Request,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const reason = cleanText(dto.reason, true)!;
    const sourceNote = cleanText(dto.source_note ?? undefined);
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.review-supplement', { event_id: eventId, ...dto },
      async (manager) => {
        const row = await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY', true);
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
        const reviewId = await this.persistence.insertEvent(manager, row.id, session.userId, 'SUPPLEMENT_REVIEW', 'STAFF', row.status, row.status, reason, {
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
        await this.persistence.notifyReporter(manager, row.reporter_user_id, row.id, Number(updated[0]!.version), 'SUPPLEMENT_REVIEWED', `SUPPLEMENT_${dto.decision}`);
        return { status: 200, value: { id: row.id, status: updated[0]!.status, version: Number(updated[0]!.version), decision: dto.decision, event_id: reviewId, verification_revision: updated[0]!.verification_revision }, resource: { type: 'request_event', id: reviewId } };
      },
      async (manager, resource) => {
        await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY');
        const rows = await manager.query('SELECT id,payload FROM request_event WHERE id=$1 AND request_id=$2 AND event_type=\'SUPPLEMENT_REVIEW\'', [resource?.id, requestId]) as Array<{ id: string; payload: Record<string, unknown> }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        const current = await this.persistence.currentRequestValue(manager, requestId);
        return { ...current, event_id: rows[0].id, decision: rows[0].payload.decision };
      },
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

















}
