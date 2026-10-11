import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import type { IdempotentResult } from '../../../../packages/technical/src/idempotency/idempotency';
import { ReporterSessionService } from '../requests/reporter-session';
import { TriageRequestDto } from './request-operations.dto';
import { RequestOperationsCommandRunner } from './request-operations.command-runner.service';
import { RequestOperationsPersistenceService } from './request-operations.persistence.service';
import { checkVersion, cleanText } from './request-operations.helpers';

@Injectable()
export class RequestOperationsTriageService {
  constructor(
    private readonly sessions: ReporterSessionService,
    private readonly commandRunner: RequestOperationsCommandRunner,
    private readonly persistence: RequestOperationsPersistenceService,
  ) {}

  async triage(requestId: string, dto: TriageRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    const session = await this.sessions.require(request);
    const reason = cleanText(dto.reason ?? undefined);
    return this.commandRunner.runCommand(requestId, session, key, 'response.requests.triage', dto,
      async (manager) => {
        const row = await this.persistence.staffRequest(manager, requestId, session, 'REQUEST_TRIAGE', true);
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
        await this.persistence.insertEvent(manager, row.id, session.userId, eventType, nextStatus !== row.status ? 'REPORTER' : 'STAFF', row.status, nextStatus, reason, {
          public_text_code: nextStatus !== row.status ? 'REQUEST_TRIAGED' : undefined,
          priority: dto.priority, priority_basis: dto.priority_basis,
        });
        if (nextStatus !== row.status) await this.persistence.notifyReporter(manager, row.reporter_user_id, row.id, Number(updated[0]!.version), 'REQUEST_STATUS_CHANGED', 'REQUEST_TRIAGED');
        return { status: 200, value: { id: row.id, status: updated[0]!.status, version: Number(updated[0]!.version), priority: updated[0]!.priority, priority_basis: updated[0]!.priority_basis }, resource: { type: 'assistance_request', id: row.id } };
      },
      (manager) => this.persistence.currentRequestValue(manager, requestId),
    );
  }
}
