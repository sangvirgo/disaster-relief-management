import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors';
import { canonicalRequestHash, IdempotencyService, IdempotentOutcome, IdempotentResult } from '../../../../packages/technical/src/idempotency';
import type { ReporterSession } from '../requests/reporter-session';

@Injectable()
export class RequestOperationsCommandRunner {
  private readonly logger = new Logger('RequestOperationsService');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly idempotency: IdempotencyService,
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
    return this.idempotency.execute(this.dataSource, {
      scopeKey: `response.request-operation:${requestId}:${session.userId}`,
      command, key,
      requestHash: canonicalRequestHash({ request_id: requestId, actor_user_id: session.userId, dto }),
      execute, replay,
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
