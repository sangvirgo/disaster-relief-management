import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { canonicalRequestHash, IdempotencyService, type IdempotentOutcome, type IdempotentResult } from '../../../../packages/technical/src/idempotency/idempotency';
import { hasPermission } from '../../../../packages/identity-contracts/src/permissions';
import { LogisticsCycleClient, type FulfillmentNeedEvidence, type ResolutionOutcomeBasis } from '../integrations/logistics/logistics-cycle.client';
import { ReporterSessionService, type ReporterSession } from '../requests/reporter-session';
import { cleanText } from '../operations/request-operations.helpers';
import { assertResolutionReady, type ResolutionMissionEvidence, type ResolutionNeedEvidence } from './request-resolution.rules';
import type { ResolveRequestDto } from './request-resolution.dto';
import { RequestResolutionFinalizer } from './request-resolution-finalizer.service';

type OperationRequest = Request & { idempotencyKey?: string };
interface RequestRow {
  id: string;
  status: string;
  version: number;
  work_cycle: number;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
  reporter_user_id: string | null;
  logistics_admitted_at: Date | string | null;
}
interface MissionEvidenceRow {
  status: string;
  has_outcome_evidence: boolean;
  failure_reviewed: boolean;
}
interface InternalOperation {
  id: string;
  kind: 'RESOLUTION' | 'CANCELLATION';
  state: 'PENDING' | 'ABORTING' | 'COMPLETED' | 'ABORTED';
  request_id: string;
  work_cycle: number;
  request_status: string;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
  outcome_basis: ResolutionOutcomeBasis | null;
  version: number;
}

const resolvableStatuses = ['TRIAGED', 'DISPATCHED', 'IN_PROGRESS'];
const requestUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function assertCanResolve(session: ReporterSession, row: RequestRow): void {
  if (!hasPermission(session.grants, 'REQUEST_RESOLVE', {
    organizationId: row.organization_id, regionCode: row.region_code, campaignId: row.campaign_id,
  })) throw new AppError('FORBIDDEN', { status: 403 });
}

function normalizeNeeds(needs: readonly FulfillmentNeedEvidence[]): ResolutionNeedEvidence[] {
  return needs.map(({ status, delivered, reserved, unsettledIssued }) => ({ status, delivered, reserved, unsettledIssued }));
}

@Injectable()
export class RequestResolutionService {
  private readonly logger = new Logger(RequestResolutionService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: ReporterSessionService,
    private readonly logistics: LogisticsCycleClient,
    private readonly finalizer: RequestResolutionFinalizer,
  ) {}

  async resolve(
    requestId: string, dto: ResolveRequestDto, key: string, request: OperationRequest,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    if (!['RESCUE_COMPLETED', 'SUPPLY_ONLY', 'NO_ACTION_REQUIRED'].includes(dto.outcome_basis)) {
      throw new AppError('RESOLUTION_BASIS_INVALID', { status: 409 });
    }
    const reason = cleanText(dto.resolution_reason, true)!;
    const preflightRows = await this.dataSource.query(
      `SELECT id,status,version,work_cycle,organization_id,region_code,campaign_id,reporter_user_id,logistics_admitted_at
         FROM assistance_request WHERE id=$1`, [requestId],
    ) as RequestRow[];
    const preflight = preflightRows[0];
    if (!preflight) throw new AppError('NOT_FOUND', { status: 404 });
    assertCanResolve(session, preflight);
    const scopeKey = `response.request-resolve:${requestId}:${session.userId}`;
    const command = 'response.requests.resolve';
    const requestHash = canonicalRequestHash({ request_id: requestId, actor_user_id: session.userId, dto });
    const existingKeys = await this.dataSource.query(
      `SELECT 1 FROM idempotency_record WHERE scope_key=$1 AND command=$2 AND idempotency_key=$3`,
      [scopeKey, command, key],
    ) as unknown[];
    const needs = existingKeys.length > 0 || preflight.logistics_admitted_at === null
      ? []
      : normalizeNeeds(await this.logistics.fulfillment(requestId, Number(preflight.work_cycle), request));

    const result = await this.idempotency.execute(this.dataSource, {
      scopeKey,
      command,
      key,
      requestHash,
      execute: (manager) => this.createResolutionIntent(manager, requestId, dto.expected_version, reason, dto.outcome_basis, needs, session),
      replay: async (_manager, resource) => {
        if (resource?.type !== 'resolution_intent') throw new AppError('INTERNAL_ERROR', { status: 500 });
        return { operation_id: resource.id, state: 'PENDING' };
      },
    });
    const operationId = result.value.operation_id;
    if (typeof operationId === 'string' && !result.replay) {
      try { await this.finalizer.completePending(operationId); }
      catch (error) { this.logDeferred(operationId, error); }
    }
    return result;
  }

  async operation(operationId: string, request: Request): Promise<Record<string, unknown>> {
    const session = await this.sessions.require(request);
    const rows = await this.dataSource.query(
      `SELECT i.id,i.kind,i.state,i.request_id,i.work_cycle,i.version,r.status AS request_status,
              r.organization_id,r.region_code,r.campaign_id
         FROM resolution_intent i JOIN assistance_request r ON r.id=i.request_id WHERE i.id=$1`, [operationId],
    ) as InternalOperation[];
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { status: 404 });
    const permission = row.kind === 'CANCELLATION' ? 'REQUEST_CANCEL' : 'REQUEST_RESOLVE';
    if (!hasPermission(session.grants, permission, {
      organizationId: row.organization_id, regionCode: row.region_code, campaignId: row.campaign_id,
    })) throw new AppError('FORBIDDEN', { status: 403 });
    return this.publicOperation(row);
  }

  async internalOperation(intentId: string): Promise<Record<string, unknown>> {
    const rows = await this.dataSource.query(
      `SELECT i.id,i.kind,i.state,i.request_id,i.work_cycle,i.version,r.status AS request_status,
              r.organization_id,r.region_code,r.campaign_id,
              (SELECT e.payload->>'outcome_basis' FROM request_event e
                WHERE e.request_id=i.request_id AND e.event_type='RESOLUTION_INTENT_CREATED'
                  AND e.payload->>'intent_id'=i.id::text ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1) AS outcome_basis
         FROM resolution_intent i JOIN assistance_request r ON r.id=i.request_id WHERE i.id=$1`, [intentId],
    ) as InternalOperation[];
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { status: 404 });
    return {
      id: row.id,
      kind: row.kind,
      state: row.state,
      request_id: row.request_id,
      work_cycle: Number(row.work_cycle),
      request_status: row.request_status,
      organization_id: row.organization_id,
      region_code: row.region_code,
      campaign_id: row.campaign_id,
      outcome_basis: row.outcome_basis,
    };
  }

  private async createResolutionIntent(
    manager: EntityManager,
    requestId: string,
    expectedVersion: number,
    reason: string,
    basis: ResolutionOutcomeBasis,
    needs: readonly ResolutionNeedEvidence[],
    session: ReporterSession,
  ): Promise<IdempotentOutcome<Record<string, unknown>>> {
    const rows = await manager.query(
      `SELECT id,status,version,work_cycle,organization_id,region_code,campaign_id,reporter_user_id,logistics_admitted_at
         FROM assistance_request WHERE id=$1 FOR UPDATE`, [requestId],
    ) as RequestRow[];
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { status: 404 });
    assertCanResolve(session, row);
    if (!resolvableStatuses.includes(row.status)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
    if (Number(row.version) !== expectedVersion) throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(row.version) } });

    const pendingSupplements = await manager.query(
      `SELECT 1 FROM request_event supplement
        WHERE supplement.request_id=$1 AND supplement.event_type='REPORTER_SUPPLEMENT'
          AND supplement.payload->>'pending_review'='true'
          AND NOT EXISTS (SELECT 1 FROM request_event review WHERE review.request_id=supplement.request_id
            AND review.event_type='SUPPLEMENT_REVIEW' AND review.payload->>'reviewed_event_id'=supplement.id::text)
        LIMIT 1`, [requestId],
    ) as unknown[];
    const missionRows = await manager.query(
      `SELECT m.status,m.version,
              (EXISTS (SELECT 1 FROM mission_event me WHERE me.mission_id=m.id AND me.to_status='COMPLETED' AND me.outcome_note IS NOT NULL)
                OR EXISTS (SELECT 1 FROM evidence_metadata em WHERE em.mission_id=m.id AND em.state='READY')) AS has_outcome_evidence,
              EXISTS (SELECT 1 FROM request_event review WHERE review.request_id=m.request_id
                AND review.event_type='MISSION_FAILURE_REVIEW' AND review.payload->>'mission_id'=m.id::text
                AND review.payload->>'mission_version'=m.version::text) AS failure_reviewed
         FROM mission m WHERE m.request_id=$1 AND m.work_cycle=$2 ORDER BY m.id`, [requestId, row.work_cycle],
    ) as MissionEvidenceRow[];
    const missions: ResolutionMissionEvidence[] = missionRows.map((mission) => ({
      status: mission.status,
      hasOutcomeEvidence: mission.has_outcome_evidence,
      failureReviewed: mission.failure_reviewed,
    }));
    assertResolutionReady({ basis, reason, hasPendingSupplement: pendingSupplements.length > 0, missions, needs });

    const intents = await manager.query(
      `INSERT INTO resolution_intent
         (request_id,work_cycle,kind,actor_user_id,expected_request_version,previous_status,reason)
       VALUES ($1,$2,'RESOLUTION',$3,$4+1,$5,$6) RETURNING id`,
      [requestId, row.work_cycle, session.userId, expectedVersion, row.status, reason],
    ) as Array<{ id: string }>;
    const intent = intents[0];
    if (!intent) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const [updated] = await manager.query(
      `UPDATE assistance_request SET status='RESOLVING',version=version+1
        WHERE id=$1 AND status=$2 AND version=$3 RETURNING id,version`,
      [requestId, row.status, expectedVersion],
    ) as [Array<{ id: string; version: number }>, number];
    if (!updated?.[0]) throw new AppError('VERSION_CONFLICT', { status: 409, details: { current_version: Number(row.version) } });
    await manager.query(
      `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,reason,payload)
       VALUES ($1,$2,'RESOLUTION_INTENT_CREATED','STAFF',$3,'RESOLVING',$4,$5::jsonb)`,
      [requestId, session.userId, row.status, reason, JSON.stringify({ intent_id: intent.id, outcome_basis: basis })],
    );
    return {
      status: 202,
      value: { operation_id: intent.id, state: 'PENDING' },
      resource: { type: 'resolution_intent', id: intent.id },
    };
  }

  private publicOperation(row: InternalOperation): Record<string, unknown> {
    return { operation_id: row.id, kind: row.kind, state: row.state, version: Number(row.version), request_id: row.request_id,
      work_cycle: Number(row.work_cycle), request_status: row.request_status };
  }

  private logDeferred(operationId: string, error: unknown): void {
    const code = error instanceof AppError ? error.code : 'UNEXPECTED';
    this.logger.warn(`Resolution finalization deferred (${code}) for operation ${operationId}`);
  }
}
