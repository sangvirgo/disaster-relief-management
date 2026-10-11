import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors';
import type { IdempotentResult } from '../../../../packages/technical/src/idempotency';
import { hasPermission } from '../../../../packages/technical/src/permissions';
import { ReporterSessionService } from '../requests/reporter-session';
import type { RequestCoordinatorGrant } from '../requests/reporter-session';
import type { ContactAttemptDto, ConcurRequestDto, RejectRequestDto, RequestVersionDto, VerifyRequestDto } from "./request-operations.dto";
import { checkVersion, cleanText, grantCovers, toIso, unverifiedStatuses } from './request-operations.helpers';
import { sourceRefsView } from './request-operations.mapper';
import { RequestOperationsCommandRunner } from './request-operations.command-runner.service';
import { RequestOperationsPersistenceService } from './request-operations.persistence.service';
import { hasPendingSupplement, latestMaterialFactEventId, validConcurrence, validateSourceRefs, approvedFacts as loadApprovedFacts } from './request-operations.verification.helpers';
import type { OperationRequestRow } from './request-operations.types';
@Injectable()
export class RequestOperationsVerificationService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly sessions: ReporterSessionService,
    private readonly persistence: RequestOperationsPersistenceService,
    private readonly commandRunner: RequestOperationsCommandRunner,
  ) {}

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
        if (await hasPendingSupplement(manager, row.id)) throw new AppError('PENDING_SUPPLEMENT_REVIEW', { status: 409 });
        const attemptRows = await manager.query('SELECT id,outcome FROM contact_attempt WHERE request_id=$1', [row.id]) as Array<{ id: string; outcome: string }>;
        if (!attemptRows.length && !reason) throw new AppError('NO_CONTACT_ATTEMPT', { status: 409 });
        const refs = await validateSourceRefs(manager, row, dto.source_refs, session);
        if (dto.basis === 'CONTACT_CONFIRMED' && !refs.attempts.some((attempt) => attempt.outcome === 'REACHED') && !attemptRows.some((attempt) => attempt.outcome === 'REACHED')) {
          throw new AppError('VERIFICATION_BASIS_REQUIRED', { status: 400 });
        }
        if (dto.basis === 'CORROBORATED' && !refs.requests.length && !sourceNote) throw new AppError('VERIFICATION_BASIS_REQUIRED', { status: 400 });
        if (dto.basis === 'EVIDENCE_REVIEWED' && !refs.evidence.length) throw new AppError('VERIFICATION_BASIS_REQUIRED', { status: 400 });
        let concurringUserId: string | null = null;
        if (dto.basis === 'TWO_COORDINATOR_JUDGMENT') {
          if (!reason || !dto.concurrence_event_id) throw new AppError('SECOND_COORDINATOR_REQUIRED', { status: 409 });
          const concurrence = await validConcurrence(manager, row, dto.concurrence_event_id, session.userId, currentCoordinators ?? []);
          concurringUserId = concurrence.actor_user_id;
        } else if (dto.concurrence_event_id) {
          throw new AppError('VALIDATION_FAILED', { status: 400 });
        }
        if (row.report_mode === 'PROXY' && !refs.independent && dto.basis !== 'TWO_COORDINATOR_JUDGMENT') {
          throw new AppError('SECOND_COORDINATOR_REQUIRED', { status: 409 });
        }
        const approvedFacts = await loadApprovedFacts(manager, row.id);
        const decisionRows = await manager.query(
          `INSERT INTO verification_decision (request_id,outcome,basis,reviewer_user_id,concurring_user_id,reason)
           VALUES ($1,'VERIFIED',$2,$3,$4,$5) RETURNING id`,
          [row.id, dto.basis, session.userId, concurringUserId, reason],
        ) as Array<{ id: string }>;
        const decision = decisionRows[0];
        if (!decision) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const eventId = await this.persistence.insertEvent(manager, row.id, session.userId, 'REQUEST_VERIFIED', 'REPORTER', row.status, 'VERIFIED', reason, {
          public_text_code: 'REQUEST_VERIFIED', basis: dto.basis, decision_id: decision.id,
          source_refs: sourceRefsView(dto.source_refs), source_note: sourceNote,
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
        const materialFactEventId = await latestMaterialFactEventId(manager, row.id);
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
}
