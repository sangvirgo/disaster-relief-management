import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import type { IdempotentResult, ResourceRef } from '@c48/technical/idempotency/idempotency';
import { ReporterSessionService } from '../requests/reporter-session';
import type { ReporterSession } from '../requests/reporter-session';
import { RequestOperationsCommandRunner } from './request-operations.command-runner.service';
import { RequestOperationsPersistenceService } from './request-operations.persistence.service';
import { RequestClaimGuard } from './request-claims.guard';
import type { ClaimRow } from './request-claims.guard';
import { canCoordinateRequest, claimIsActive, isSystemCoordinator } from './request-claims.helpers';

@Injectable()
export class RequestClaimService {
  constructor(
    private readonly sessions: ReporterSessionService,
    private readonly commandRunner: RequestOperationsCommandRunner,
    private readonly persistence: RequestOperationsPersistenceService,
    private readonly guard: RequestClaimGuard,
  ) {}

  async claim(requestId: string, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.claim', {},
      async (manager) => {
        const row = await this.guard.loadClaim(manager, requestId);
        if (!canCoordinateRequest(session.grants, row.campaign_id)) throw new AppError('FORBIDDEN', { status: 403 });
        if (row.handled_by === session.userId) {
          await manager.query('UPDATE assistance_request SET handled_at=now() WHERE id=$1 AND handled_by=$2', [requestId, session.userId]);
          return { status: 200, value: this.projection(row, session.userId, row.db_now.toISOString()), resource: { type: 'assistance_request', id: requestId } };
        }
        if (row.handled_by && claimIsActive(row.handled_at, row.db_now)) throw await this.guard.conflictFor(row.handled_by);

        await manager.query('UPDATE assistance_request SET handled_by=$2,handled_at=now() WHERE id=$1', [requestId, session.userId]);
        const eventId = await this.persistence.insertEvent(manager, requestId, session.userId, 'CLAIMED', 'STAFF',
          row.status, row.status, null, { previous_handled_by: row.handled_by });
        return { status: 200, value: this.projection(row, session.userId, row.db_now.toISOString()), resource: { type: 'request_event', id: eventId } };
      },
      (manager, resource) => this.replay(manager, resource, requestId, session),
    );
  }

  async release(requestId: string, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.release', {},
      async (manager) => {
        const row = await this.guard.loadClaim(manager, requestId);
        if (!row.handled_by) {
          return { status: 200, value: this.projection(row, null, null), resource: { type: 'assistance_request', id: requestId } };
        }
        this.assertCanRelease(session, row);
        await manager.query('UPDATE assistance_request SET handled_by=NULL,handled_at=NULL WHERE id=$1', [requestId]);
        const eventId = await this.persistence.insertEvent(manager, requestId, session.userId, 'CLAIM_RELEASED', 'STAFF',
          row.status, row.status, null, { previous_handled_by: row.handled_by });
        return { status: 200, value: this.projection(row, null, null), resource: { type: 'request_event', id: eventId } };
      },
      (manager, resource) => this.replay(manager, resource, requestId, session),
    );
  }

  private assertCanRelease(session: ReporterSession, row: ClaimRow): void {
    if (row.handled_by === session.userId) {
      if (!canCoordinateRequest(session.grants, row.campaign_id)) throw new AppError('FORBIDDEN', { status: 403 });
      return;
    }
    if (!isSystemCoordinator(session.grants)) throw new AppError('FORBIDDEN', { status: 403 });
  }

  private projection(row: ClaimRow, handledBy: string | null, handledAt: string | null): Record<string, unknown> {
    return {
      id: row.id,
      status: row.status,
      version: Number(row.version),
      campaign_id: row.campaign_id,
      handled_by: handledBy,
      handled_at: handledAt,
    };
  }

  private async view(manager: EntityManager, requestId: string): Promise<Record<string, unknown>> {
    const row = await this.guard.loadClaim(manager, requestId);
    return this.projection(row, row.handled_by, row.handled_at ? new Date(row.handled_at).toISOString() : null);
  }

  private async replay(
    manager: EntityManager,
    resource: ResourceRef | null,
    requestId: string,
    session: ReporterSession,
  ): Promise<Record<string, unknown>> {
    if (!resource) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const row = await this.guard.loadClaim(manager, requestId);
    if (!canCoordinateRequest(session.grants, row.campaign_id)) throw new AppError('FORBIDDEN', { status: 403 });
    return this.view(manager, requestId);
  }
}
