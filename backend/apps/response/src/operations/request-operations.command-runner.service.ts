import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '@c48/technical/errors/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentOutcome, IdempotentResult } from '@c48/technical/idempotency/idempotency';
import type { ReporterSession } from '../requests/reporter-session';
import { RequestClaimGuard } from './request-claims.guard';

/** Coordination commands that respect another coordinator's active claim (see request-claims.helpers). */
export const CLAIM_GUARDED_COMMANDS: ReadonlySet<string> = new Set([
  'response.requests.start-verification',
  'response.requests.verify',
  'response.requests.concur',
  'response.requests.reject',
  'response.requests.triage',
  'response.requests.fast-track',
  'response.requests.attach-campaign',
  'response.requests.detach-campaign',
]);

@Injectable()
export class RequestOperationsCommandRunner {
  private readonly logger = new Logger('RequestOperationsService');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
    private readonly claimGuard: RequestClaimGuard,
  ) {}

  runCommand<T>(
    requestId: string,
    session: ReporterSession,
    key: string,
    command: string,
    dto: unknown,
    execute: (manager: EntityManager) => Promise<IdempotentOutcome<T>>,
    replay: (manager: EntityManager, resource: { type: string; id: string } | null, status: number) => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    const guarded = CLAIM_GUARDED_COMMANDS.has(command)
      ? async (manager: EntityManager) => {
        await this.claimGuard.assertCanCoordinate(manager, requestId, session, command);
        return execute(manager);
      }
      : execute;
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.request-operation:${requestId}:${session.userId}`,
      command, key,
      requestHash: canonicalRequestHash({ request_id: requestId, actor_user_id: session.userId, dto }),
      execute: guarded, replay,
    }).catch((error: unknown) => {
      if (!(error instanceof AppError) || error.code === 'INTERNAL_ERROR') {
        const value = error && typeof error === 'object' ? error as { code?: unknown; driverError?: { code?: unknown } } : {};
        const sqlState = value.driverError?.code ?? value.code;
        const code = error instanceof AppError ? error.code
          : typeof sqlState === 'string' && /^[0-9A-Z]{5}$/u.test(sqlState) ? `DATABASE_${sqlState}`
            : error instanceof TypeError ? 'UNEXPECTED_TYPE_ERROR' : 'UNEXPECTED_ERROR';
        this.logger.error({ code }, command);
      }
      throw error;
    });
  }
}
