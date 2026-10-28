import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentOutcome, IdempotentResult } from '../../../../packages/technical/src/idempotency/idempotency';
import { ReporterSessionService } from '../requests/reporter-session';
import { RequestOperationsPersistenceService } from './request-operations.persistence.service';
import type { AiAdvisoryReviewDto, RequestVersionDto } from './request-operations.dto';
import { isAiAdvisoryFresh, loadAssessmentFacts } from '../ai/ai-advisory-input';
import { checkVersion } from './request-operations.helpers';

@Injectable()
export class RequestOperationsAiAdvisoryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: ReporterSessionService,
    private readonly persistence: RequestOperationsPersistenceService,
  ) {}

  async review(requestId: string, advisoryId: string, dto: AiAdvisoryReviewDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    if (dto.decision === 'ADJUSTED' && !dto.note?.trim()) {
      throw new AppError('VALIDATION_FAILED', { status: 400, fieldErrors: { note: ['Vui lòng ghi nội dung điều chỉnh của người điều phối.'] } });
    }
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.request-ai-review:${requestId}:${session.userId}`,
      command: 'response.requests.review-ai-advisory',
      key,
      requestHash: canonicalRequestHash({ request_id: requestId, advisory_id: advisoryId, user_id: session.userId, dto }),
      execute: async (manager) => {
        const row = await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY', true);
        checkVersion(Number(row.version), dto.expected_version);
        const rows = await manager.query(
          `SELECT id,status,review_status,request_version,input_hash,
                  (SELECT id FROM ai_advisory WHERE request_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1) AS latest_id
             FROM ai_advisory WHERE id=$1 AND request_id=$2 FOR UPDATE`, [advisoryId, requestId],
        ) as Array<Record<string, unknown> & { id: string; status: string; review_status: string | null }>;
        const advisory = rows[0];
        if (!advisory || advisory.status !== 'COMPLETED') throw new AppError('NOT_FOUND', { status: 404 });
        if (advisory.review_status) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const facts = await loadAssessmentFacts(manager, requestId);
        if (advisory.latest_id !== advisory.id || !isAiAdvisoryFresh(advisory, facts, facts.workCycle)) {
          throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(row.version) } });
        }
        const updated = await manager.query(
          'UPDATE ai_advisory SET review_status=$2,review_by_user_id=$3,review_at=now(),review_note=$4 WHERE id=$1 AND review_status IS NULL RETURNING id',
          [advisory.id, dto.decision, session.userId, dto.note?.trim() ?? null],
        ) as Array<{ id: string }>;
        if (!updated[0]) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const payload = { advisory_id: advisory.id, decision: dto.decision, note: dto.note?.trim() ?? null };
        const events = await manager.query(
          `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,payload)
           VALUES ($1,$2,'AI_ADVISORY_REVIEW','STAFF',$3::jsonb) RETURNING id`,
          [requestId, session.userId, JSON.stringify(payload)],
        ) as Array<{ id: string }>;
        if (!events[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
        return { status: 200, value: { request_id: requestId, advisory_id: advisory.id, decision: dto.decision }, resource: { type: 'request_event', id: events[0].id } };
      },
      replay: async (manager: EntityManager, resource) => {
        if (!resource || resource.type !== 'request_event') throw new AppError('INTERNAL_ERROR', { status: 500 });
        await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_DETAIL_READ');
        const rows = await manager.query('SELECT payload FROM request_event WHERE id=$1 AND request_id=$2 AND event_type=\'AI_ADVISORY_REVIEW\'', [resource.id, requestId]) as Array<{ payload: Record<string, unknown> }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        return { request_id: requestId, advisory_id: rows[0].payload.advisory_id, decision: rows[0].payload.decision };
      },
    });
  }

  async retry(requestId: string, advisoryId: string, dto: RequestVersionDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.request-ai-retry:${requestId}:${session.userId}`,
      command: 'response.requests.retry-ai-advisory',
      key,
      requestHash: canonicalRequestHash({ request_id: requestId, advisory_id: advisoryId, user_id: session.userId, dto }),
      execute: async (manager) => {
        const row = await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_VERIFY', true);
        checkVersion(Number(row.version), dto.expected_version);
        const rows = await manager.query(
          `SELECT id,status,review_status,request_version,input_hash,attempts,
                  (SELECT id FROM ai_advisory WHERE request_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1) AS latest_id
             FROM ai_advisory WHERE id=$1 AND request_id=$2 FOR UPDATE`, [advisoryId, requestId],
        ) as Array<Record<string, unknown> & { id: string; status: string; review_status: string | null; attempts: number }>;
        const advisory = rows[0];
        if (!advisory) throw new AppError('NOT_FOUND', { status: 404 });
        if (advisory.status !== 'FAILED' || advisory.review_status) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const facts = await loadAssessmentFacts(manager, requestId);
        if (advisory.latest_id !== advisory.id || !isAiAdvisoryFresh(advisory, facts, facts.workCycle)) {
          throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(row.version) } });
        }
        if (!process.env.GEMINI_API_KEY) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const updated = await manager.query(
          `UPDATE ai_advisory SET status='QUEUED',attempts=0,error_code=NULL,completed_at=NULL,
                  extracted_json=NULL,lease_until=NULL,claim_token=NULL
            WHERE id=$1 AND status='FAILED' AND review_status IS NULL RETURNING id`, [advisory.id],
        ) as Array<{ id: string }>;
        if (!updated[0]) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        const payload = { advisory_id: advisory.id, previous_attempts: Number(advisory.attempts), status: 'QUEUED' };
        const events = await manager.query(
          `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,payload)
           VALUES ($1,$2,'AI_ADVISORY_RETRY','STAFF',$3::jsonb) RETURNING id`,
          [requestId, session.userId, JSON.stringify(payload)],
        ) as Array<{ id: string }>;
        if (!events[0]) throw new AppError('INTERNAL_ERROR', { status: 500 });
        return { status: 202, value: { request_id: requestId, advisory_id: advisory.id, status: 'QUEUED' }, resource: { type: 'request_event', id: events[0].id } };
      },
      replay: async (manager: EntityManager, resource) => {
        if (!resource || resource.type !== 'request_event') throw new AppError('INTERNAL_ERROR', { status: 500 });
        await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_DETAIL_READ');
        const rows = await manager.query(
          "SELECT payload FROM request_event WHERE id=$1 AND request_id=$2 AND event_type='AI_ADVISORY_RETRY'",
          [resource.id, requestId],
        ) as Array<{ payload: Record<string, unknown> }>;
        if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
        return { request_id: requestId, advisory_id: rows[0].payload.advisory_id, status: rows[0].payload.status };
      },
    });
  }
}
