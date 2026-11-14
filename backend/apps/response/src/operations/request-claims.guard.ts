import { Injectable, Logger } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { ReporterSessionService } from '../requests/reporter-session';
import type { ReporterSession } from '../requests/reporter-session';
import { RequestOperationsPersistenceService } from './request-operations.persistence.service';
import { claimConflictMessage, claimIsActive, isSystemCoordinator } from './request-claims.helpers';

export interface ClaimRow {
  id: string;
  status: string;
  version: number;
  campaign_id: string | null;
  handled_by: string | null;
  handled_at: Date | string | null;
  db_now: Date;
}

/**
 * Enforces the soft "nhận xử lý" claim on coordination commands. The check runs inside the command
 * transaction, after the request row is locked, so a claim cannot change between check and write.
 */
@Injectable()
export class RequestClaimGuard {
  private readonly logger = new Logger('RequestClaimGuard');

  constructor(
    private readonly sessions: ReporterSessionService,
    private readonly persistence: RequestOperationsPersistenceService,
  ) {}

  async loadClaim(manager: EntityManager, requestId: string): Promise<ClaimRow> {
    const rows = await manager.query(
      `SELECT id,status,version,campaign_id,handled_by,handled_at,now() AS db_now
         FROM assistance_request WHERE id=$1 FOR UPDATE`,
      [requestId],
    ) as ClaimRow[];
    if (!rows[0]) throw new AppError('NOT_FOUND', { status: 404 });
    return rows[0];
  }

  /** Builds the 409 for an active claim held by someone else; the holder name is looked up in Identity. */
  async conflictFor(holderId: string): Promise<AppError> {
    let holderName: string | null = null;
    try {
      const [profile] = await this.sessions.lookupUsers([holderId]);
      holderName = profile?.display_name?.trim() || null;
    } catch (error) {
      this.logger.warn({ code: error instanceof AppError ? error.code : 'IDENTITY_LOOKUP_FAILED' }, 'claim holder lookup');
    }
    return new AppError('REQUEST_ALREADY_CLAIMED', {
      status: 409,
      userMessage: claimConflictMessage(holderName),
      details: { handled_by: holderId },
    });
  }

  async assertCanCoordinate(manager: EntityManager, requestId: string, session: ReporterSession, command: string): Promise<void> {
    const row = await this.loadClaim(manager, requestId);
    if (row.handled_by === session.userId) {
      await manager.query('UPDATE assistance_request SET handled_at=now() WHERE id=$1 AND handled_by=$2', [requestId, session.userId]);
      return;
    }
    if (!row.handled_by || !claimIsActive(row.handled_at, row.db_now)) return;

    if (!isSystemCoordinator(session.grants)) throw await this.conflictFor(row.handled_by);

    await this.persistence.insertEvent(manager, requestId, session.userId, 'CLAIM_TAKEN_OVER', 'STAFF',
      row.status, row.status, null, { previous_handled_by: row.handled_by, command });
    await manager.query('UPDATE assistance_request SET handled_by=$2,handled_at=now() WHERE id=$1', [requestId, session.userId]);
  }
}
