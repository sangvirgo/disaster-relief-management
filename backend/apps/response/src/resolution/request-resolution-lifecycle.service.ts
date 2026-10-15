import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Request } from 'express';
import type { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { canonicalRequestHash, IdempotencyService, type IdempotentOutcome, type IdempotentResult } from '../../../../packages/technical/src/idempotency/idempotency';
import { hasPermission } from '../../../../packages/technical/src/security/permissions';
import { cleanText, checkVersion } from '../operations/request-operations.helpers';
import { ReporterSessionService, type ReporterSession } from '../requests/reporter-session';
import { RequestResolutionFinalizer } from './request-resolution-finalizer.service';
import type { RequestVersionReasonDto } from './request-resolution.dto';

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
interface OperationRow {
  id: string;
  request_id: string;
  kind: 'RESOLUTION' | 'CANCELLATION';
  state: 'PENDING' | 'ABORTING' | 'COMPLETED' | 'ABORTED';
  version: number;
  work_cycle: number;
  request_status: string;
  request_version: number;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
}

const cancellableStatuses = ['TRIAGED', 'DISPATCHED', 'IN_PROGRESS'];

@Injectable()
export class RequestResolutionLifecycleService {
  private readonly logger = new Logger(RequestResolutionLifecycleService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly sessions: ReporterSessionService,
    private readonly finalizer: RequestResolutionFinalizer,
  ) {}

  async cancel(requestId: string, dto: RequestVersionReasonDto, key: string, request: OperationRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const reason = cleanText(dto.reason, true)!;
    const preflightRows = await this.dataSource.query(
      `SELECT id,status,version,work_cycle,organization_id,region_code,campaign_id,reporter_user_id,logistics_admitted_at
         FROM assistance_request WHERE id=$1`, [requestId],
    ) as RequestRow[];
    const preflight = preflightRows[0];
    if (!preflight) throw new AppError('NOT_FOUND', { status: 404 });
    this.assertPermission(session, preflight, 'REQUEST_CANCEL');

    const result = await this.idempotency.execute(this.dataSource, {
      scopeKey: `response.request-cancel:${requestId}:${session.userId}`,
      command: 'response.requests.cancel',
      key,
      requestHash: canonicalRequestHash({ request_id: requestId, actor_user_id: session.userId, dto }),
      execute: (manager) => this.createCancellationIntent(manager, requestId, dto.expected_version, reason, session),
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

  async abortForRequest(requestId: string, dto: RequestVersionReasonDto, key: string, request: OperationRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const operation = await this.findOpenOperation(requestId);
    if (operation.kind !== 'RESOLUTION') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
    this.assertPermission(session, operation, 'REQUEST_RESOLVE');
    return this.abort(operation.id, dto, key, session);
  }

  async abortOperation(operationId: string, dto: RequestVersionReasonDto, key: string, request: OperationRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const operation = await this.findOperation(operationId);
    const permission = operation.kind === 'CANCELLATION' ? 'REQUEST_CANCEL' : 'REQUEST_RESOLVE';
    this.assertPermission(session, operation, permission);
    return this.abort(operationId, dto, key, session);
  }

  async adopt(operationId: string, dto: RequestVersionReasonDto, key: string, request: OperationRequest): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const reason = cleanText(dto.reason, true)!;
    const operation = await this.findOperation(operationId);
    const permission = operation.kind === 'CANCELLATION' ? 'REQUEST_CANCEL' : 'REQUEST_RESOLVE';
    this.assertPermission(session, operation, permission);
    const result = await this.idempotency.execute(this.dataSource, {
      scopeKey: `response.operation-adopt:${operationId}:${session.userId}`,
      command: 'response.operations.adopt',
      key,
      requestHash: canonicalRequestHash({ operation_id: operationId, actor_user_id: session.userId, dto }),
      execute: async (manager) => {
        const current = await this.lockOperation(manager, operationId);
        this.assertPermission(session, current, permission);
        checkVersion(Number(current.request_version), dto.expected_version);
        if (current.request_status !== 'RESOLVING' || !['PENDING', 'ABORTING'].includes(current.state)) {
          throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        }
        const updated = await manager.query(
          `UPDATE resolution_intent SET actor_user_id=$2,version=version+1,updated_at=clock_timestamp()
            WHERE id=$1 AND state=$3 RETURNING id,state,version`, [operationId, session.userId, current.state],
        ) as Array<{ id: string; state: 'PENDING' | 'ABORTING'; version: number }>;
        if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
        await manager.query(
          `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,reason,payload)
           VALUES ($1,$2,'RESOLUTION_INTENT_ADOPTED','STAFF','RESOLVING','RESOLVING',$3,$4::jsonb)`,
          [current.request_id, session.userId, reason, JSON.stringify({ operation_id: operationId, kind: current.kind })],
        );
        return { status: 202, value: { operation_id: operationId, state: updated[0]!.state }, resource: { type: 'resolution_intent', id: operationId } };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'resolution_intent') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const current = await this.operationValue(manager, resource.id, session, permission);
        return { operation_id: current.id, state: current.state };
      },
    });
    if (!result.replay && result.value.state === 'PENDING') {
      try { await this.finalizer.completePending(operationId); }
      catch (error) { this.logDeferred(operationId, error); }
    } else if (!result.replay && result.value.state === 'ABORTING') {
      try { await this.finalizer.abortIntent(operationId, reason); }
      catch (error) { this.logDeferred(operationId, error); }
    }
    return result;
  }

  private async abort(
    operationId: string, dto: RequestVersionReasonDto, key: string, session: ReporterSession,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    const reason = cleanText(dto.reason, true)!;
    const operation = await this.findOperation(operationId);
    const permission = operation.kind === 'CANCELLATION' ? 'REQUEST_CANCEL' : 'REQUEST_RESOLVE';
    const result = await this.idempotency.execute(this.dataSource, {
      scopeKey: `response.operation-abort:${operationId}:${session.userId}`,
      command: 'response.operations.abort',
      key,
      requestHash: canonicalRequestHash({ operation_id: operationId, actor_user_id: session.userId, dto }),
      execute: async (manager) => {
        const current = await this.lockOperation(manager, operationId);
        this.assertPermission(session, current, permission);
        checkVersion(Number(current.request_version), dto.expected_version);
        if (current.request_status !== 'RESOLVING') throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        if (current.state === 'PENDING') {
          const [updated] = await manager.query(
            `UPDATE resolution_intent SET state='ABORTING',version=version+1,updated_at=clock_timestamp()
              WHERE id=$1 AND state='PENDING' RETURNING id`, [operationId],
          ) as [Array<{ id: string }>, number];
          if (!updated[0]) throw new AppError('VERSION_CONFLICT', { status: 409 });
          await manager.query(
            `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,reason,payload)
             VALUES ($1,$2,$3,'STAFF','RESOLVING','RESOLVING',$4,$5::jsonb)`,
            [current.request_id, session.userId, current.kind === 'RESOLUTION' ? 'RESOLUTION_ABORT_REQUESTED' : 'CANCELLATION_ABORT_REQUESTED', reason,
              JSON.stringify({ operation_id: operationId })],
          );
        } else if (current.state !== 'ABORTING') {
          throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });
        }
        return { status: 202, value: { operation_id: operationId, state: 'ABORTING' }, resource: { type: 'resolution_intent', id: operationId } };
      },
      replay: async (manager, resource) => {
        if (resource?.type !== 'resolution_intent') throw new AppError('INTERNAL_ERROR', { status: 500 });
        const current = await this.operationValue(manager, resource.id, session, permission);
        return { operation_id: current.id, state: current.state };
      },
    });
    if (!result.replay && result.value.state === 'ABORTING') {
      try { await this.finalizer.abortIntent(operationId, reason); }
      catch (error) { this.logDeferred(operationId, error); }
    }
    return result;
  }

  private async findOpenOperation(requestId: string): Promise<OperationRow> {
    const rows = await this.dataSource.query(
      `SELECT i.id,i.request_id,i.kind,i.state,i.version,i.work_cycle,r.status AS request_status,r.version AS request_version,
              r.organization_id,r.region_code,r.campaign_id
         FROM resolution_intent i JOIN assistance_request r ON r.id=i.request_id
        WHERE i.request_id=$1 AND i.state IN ('PENDING','ABORTING')`, [requestId],
    ) as OperationRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private async findOperation(operationId: string): Promise<OperationRow> {
    const rows = await this.dataSource.query(
      `SELECT i.id,i.request_id,i.kind,i.state,i.version,i.work_cycle,r.status AS request_status,r.version AS request_version,
              r.organization_id,r.region_code,r.campaign_id
         FROM resolution_intent i JOIN assistance_request r ON r.id=i.request_id WHERE i.id=$1`, [operationId],
    ) as OperationRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private async lockOperation(manager: EntityManager, operationId: string): Promise<OperationRow> {
    const ids = await manager.query('SELECT request_id FROM resolution_intent WHERE id=$1', [operationId]) as Array<{ request_id: string }>;
    if (!ids[0]) throw new AppError('NOT_FOUND', { status: 404 });
    const requestRows = await manager.query(
      `SELECT id FROM assistance_request WHERE id=$1 FOR UPDATE`, [ids[0].request_id],
    ) as unknown[];
    if (!requestRows.length) throw new AppError('NOT_FOUND', { status: 404 });
    const rows = await manager.query(
      `SELECT i.id,i.request_id,i.kind,i.state,i.version,i.work_cycle,r.status AS request_status,r.version AS request_version,
              r.organization_id,r.region_code,r.campaign_id
         FROM assistance_request r JOIN resolution_intent i ON i.request_id=r.id
        WHERE i.id=$1 FOR UPDATE OF i`, [operationId],
    ) as OperationRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  private async createCancellationIntent(
    manager: EntityManager, requestId: string, expectedVersion: number, reason: string, session: ReporterSession,
  ): Promise<IdempotentOutcome<Record<string, unknown>>> {
    const rows = await manager.query(
      `SELECT id,status,version,work_cycle,organization_id,region_code,campaign_id,reporter_user_id,logistics_admitted_at
         FROM assistance_request WHERE id=$1 FOR UPDATE`, [requestId],
    ) as RequestRow[];
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { status: 404 });
    this.assertPermission(session, row, 'REQUEST_CANCEL');
    checkVersion(Number(row.version), expectedVersion);
    if (!cancellableStatuses.includes(row.status)) throw new AppError('STATE_TRANSITION_INVALID', { status: 409 });

    const intents = await manager.query(
      `INSERT INTO resolution_intent
         (request_id,work_cycle,kind,actor_user_id,expected_request_version,previous_status,reason)
       VALUES ($1,$2,'CANCELLATION',$3,$4+1,$5,$6) RETURNING id`,
      [requestId, row.work_cycle, session.userId, expectedVersion, row.status, reason],
    ) as Array<{ id: string }>;
    const intent = intents[0];
    if (!intent) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const [updated] = await manager.query(
      `UPDATE assistance_request SET status='RESOLVING',version=version+1
        WHERE id=$1 AND status=$2 AND version=$3 RETURNING id,version`,
      [requestId, row.status, expectedVersion],
    ) as [Array<{ id: string; version: number }>, number];
    if (!updated?.[0]) checkVersion(Number(row.version), expectedVersion);
    await manager.query(
      `INSERT INTO request_event (request_id,actor_user_id,event_type,visibility,from_status,to_status,reason,payload)
       VALUES ($1,$2,'CANCELLATION_INTENT_CREATED','STAFF',$3,'RESOLVING',$4,$5::jsonb)`,
      [requestId, session.userId, row.status, reason, JSON.stringify({ intent_id: intent.id })],
    );
    return { status: 202, value: { operation_id: intent.id, state: 'PENDING' }, resource: { type: 'resolution_intent', id: intent.id } };
  }

  private async operationValue(manager: EntityManager, operationId: string, session: ReporterSession, permission: 'REQUEST_CANCEL' | 'REQUEST_RESOLVE'): Promise<OperationRow> {
    const rows = await manager.query(
      `SELECT i.id,i.request_id,i.kind,i.state,i.version,i.work_cycle,r.status AS request_status,r.version AS request_version,
              r.organization_id,r.region_code,r.campaign_id
         FROM resolution_intent i JOIN assistance_request r ON r.id=i.request_id WHERE i.id=$1`, [operationId],
    ) as OperationRow[];
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { status: 404 });
    const required = row.kind === 'CANCELLATION' ? 'REQUEST_CANCEL' : permission;
    this.assertPermission(session, row, required);
    return row;
  }

  private assertPermission(
    session: ReporterSession,
    row: Pick<RequestRow, 'organization_id' | 'region_code' | 'campaign_id'>,
    permission: 'REQUEST_CANCEL' | 'REQUEST_RESOLVE',
  ): void {
    if (!hasPermission(session.grants, permission, {
      organizationId: row.organization_id, regionCode: row.region_code, campaignId: row.campaign_id,
    })) throw new AppError('FORBIDDEN', { status: 403 });
  }

  private logDeferred(operationId: string, error: unknown): void {
    const code = error instanceof AppError ? error.code : 'UNEXPECTED';
    this.logger.warn(`Cancellation finalization deferred (${code}) for operation ${operationId}`);
  }
}
