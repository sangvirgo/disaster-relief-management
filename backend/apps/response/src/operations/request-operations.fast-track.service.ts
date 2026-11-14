import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '@c48/technical/errors/errors';
import type { IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { aiPriorityAdvisory, currentAiAdvisory } from '../ai/ai-priority-advisory';
import { ReporterSessionService } from '../requests/reporter-session';
import type { FastTrackRequestDto } from './request-operations.dto';
import { RequestOperationsCommandRunner } from './request-operations.command-runner.service';
import { RequestOperationsPersistenceService } from './request-operations.persistence.service';
import { assessFastTrack, hasPossibleDuplicate, ruleAdvisory } from './request-operations.fast-track';
import { checkVersion, cleanText } from './request-operations.helpers';
import { approvedFacts, hasPendingSupplement } from './request-operations.verification.helpers';

const systemReason = 'Điều phối viên đã xem hồ sơ và xác nhận theo gợi ý của hệ thống.';

/**
 * One-step "accept the suggestion" for a clean SELF report: verification + priority in a single
 * coordinator-confirmed command. It never dispatches a team and never runs for proxy, flagged,
 * possibly-duplicated, or insufficiently described reports; those keep the full review path.
 */
@Injectable()
export class RequestOperationsFastTrackService {
  constructor(
    private readonly sessions: ReporterSessionService,
    private readonly commandRunner: RequestOperationsCommandRunner,
    private readonly persistence: RequestOperationsPersistenceService,
  ) {}

  async fastTrack(requestId: string, dto: FastTrackRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const note = cleanText(dto.note ?? undefined);
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.fast-track', dto,
      async (manager) => {
        const row = await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY', true);
        await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_TRIAGE');
        checkVersion(Number(row.version), dto.expected_version);
        if (!['SUBMITTED', 'VERIFYING'].includes(row.status)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });

        const subjectRows = await manager.query(
          'SELECT people_affected,children_count,elderly_count FROM request_subject WHERE request_id=$1', [row.id],
        ) as Array<{ people_affected: number | null; children_count: number | null; elderly_count: number | null }>;
        const subject = subjectRows[0];
        if (!subject) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const count = (value: unknown) => (value == null ? null : Number(value));
        const facts = {
          incidentCategoryCode: row.incident_category_code, description: row.description,
          reporterDeclaredDanger: row.reporter_declared_danger, peopleAffected: count(subject.people_affected),
          childrenCount: count(subject.children_count), elderlyCount: count(subject.elderly_count),
          needsRescue: row.needs_rescue, needsReliefSupplies: row.needs_relief_supplies,
        };
        const aiRows = await manager.query(
          `SELECT model,status,request_version,input_hash,risk_score,reason_codes,extracted_json,review_status
             FROM ai_advisory WHERE request_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`, [row.id],
        ) as Array<Record<string, unknown>>;
        const flagRows = await manager.query(
          `SELECT jsonb_array_length(coalesce(payload->'flags','[]'::jsonb)) AS flags FROM request_event
            WHERE request_id=$1 AND event_type='PROXY_ACTIVITY_FLAG' ORDER BY occurred_at DESC,id DESC LIMIT 1`, [row.id],
        ) as Array<{ flags: number }>;
        const assessment = assessFastTrack({
          status: row.status, reportMode: row.report_mode, reviewLane: row.review_lane,
          proxyFlagCount: Number(flagRows[0]?.flags ?? 0), peopleAffected: facts.peopleAffected,
          declaredDanger: row.reporter_declared_danger,
          ruleAdvisory: ruleAdvisory(facts),
          aiAdvisory: aiPriorityAdvisory(currentAiAdvisory(aiRows[0], facts, Number(row.work_cycle))),
          pendingSupplement: await hasPendingSupplement(manager, row.id),
          possibleDuplicate: await hasPossibleDuplicate(manager, row.id),
        });
        if (!assessment.eligible) {
          throw new AppError('FAST_TRACK_NOT_ELIGIBLE', { status: 409, details: { blockers: assessment.blockers } });
        }
        const priority = dto.priority ?? assessment.suggested_priority;
        if (priority !== assessment.suggested_priority && !note) throw new AppError('REASON_REQUIRED', { status: 400 });

        const attempts = await manager.query(
          `SELECT 1 FROM contact_attempt WHERE request_id=$1 AND outcome='REACHED' LIMIT 1`, [row.id],
        ) as unknown[];
        const evidence = await manager.query(
          `SELECT id FROM evidence_metadata WHERE request_id=$1 AND state='READY' ORDER BY created_at,id LIMIT 6`, [row.id],
        ) as Array<{ id: string }>;
        const basis = attempts.length ? 'CONTACT_CONFIRMED' : 'EVIDENCE_REVIEWED';
        const reason = note ? `${systemReason} ${note}` : systemReason;

        if (row.status === 'SUBMITTED') {
          await this.persistence.insertEvent(manager, row.id, session.userId, 'VERIFICATION_STARTED', 'REPORTER', 'SUBMITTED', 'VERIFYING', null,
            { public_text_code: 'REQUEST_VERIFYING', fast_track: true });
        }
        const approved = await approvedFacts(manager, row.id);
        const decisions = await manager.query(
          `INSERT INTO verification_decision (request_id,outcome,basis,reviewer_user_id,reason)
           VALUES ($1,'VERIFIED',$2,$3,$4) RETURNING id`, [row.id, basis, session.userId, reason],
        ) as Array<{ id: string }>;
        const decision = decisions[0];
        if (!decision) throw new AppError('INTERNAL_ERROR', { status: 500 });
        const verifiedEventId = await this.persistence.insertEvent(manager, row.id, session.userId, 'REQUEST_VERIFIED', 'REPORTER', 'VERIFYING', 'VERIFIED', reason, {
          public_text_code: 'REQUEST_VERIFIED', basis, decision_id: decision.id, fast_track: true,
          source_refs: evidence.length ? { evidence_ids: evidence.map((item) => item.id) } : {},
          concurring_user_id: null, approved_facts: approved,
        });
        await this.persistence.insertEvent(manager, row.id, session.userId, 'REQUEST_TRIAGED', 'REPORTER', 'VERIFIED', 'TRIAGED', note, {
          public_text_code: 'REQUEST_TRIAGED', priority, priority_basis: assessment.suggested_priority_basis,
          fast_track: true, suggested_priority: assessment.suggested_priority, suggestion_sources: assessment.sources,
        });
        const [updated] = await manager.query(
          `UPDATE assistance_request
              SET status='TRIAGED',priority=$3,priority_basis=$4,verification_revision=$5,version=version+1
            WHERE id=$1 AND version=$2 RETURNING id,status,version,priority,priority_basis,verification_revision`,
          [row.id, dto.expected_version, priority, assessment.suggested_priority_basis, verifiedEventId],
        ) as [Array<{ id: string; status: string; version: number; priority: string; priority_basis: string; verification_revision: string }>, number];
        if (!updated[0]) checkVersion(Number(row.version), dto.expected_version);
        const next = updated[0]!;
        await this.persistence.notifyReporter(manager, row.reporter_user_id, row.id, Number(next.version), 'REQUEST_STATUS_CHANGED', 'REQUEST_TRIAGED');
        return {
          status: 200,
          value: { id: row.id, status: next.status, version: Number(next.version), priority: next.priority, priority_basis: next.priority_basis,
            verification_revision: next.verification_revision, decision_id: decision.id },
          resource: { type: 'verification_decision', id: decision.id },
        };
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
}
