import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { RequestResolutionFinalizer } from './request-resolution-finalizer.service';

interface RecoveryIntent {
  id: string;
  state: 'PENDING' | 'ABORTING';
  abort_reason: string;
}

const intervalMs = 30_000;
const jobName = 'response-resolution-recovery';

@Injectable()
export class RequestResolutionRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RequestResolutionRecoveryService.name);
  private timer?: NodeJS.Timeout;
  private active = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly finalizer: RequestResolutionFinalizer,
  ) {}

  onModuleInit(): void {
    if (process.env.SCHEDULER_ENABLED !== 'true' && process.env.RESOLUTION_RECOVERY_ENABLED !== 'true') return;
    this.active = true;
    this.scheduleNext();
  }

  onModuleDestroy(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
  }

  async runOnce(): Promise<void> {
    const runner = this.dataSource.createQueryRunner();
    let locked = false;
    try {
      await runner.connect();
      const locks = await runner.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [jobName]) as Array<{ locked: boolean }>;
      locked = Boolean(locks[0]?.locked);
      if (!locked) return;

      const intents = await runner.query(
        `SELECT i.id,i.state,COALESCE(
            (SELECT e.reason FROM request_event e WHERE e.request_id=i.request_id
              AND e.event_type IN ('RESOLUTION_ABORT_REQUESTED','CANCELLATION_ABORT_REQUESTED')
              AND e.payload->>'operation_id'=i.id::text ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1),
            i.reason
          ) AS abort_reason
         FROM resolution_intent i JOIN assistance_request r ON r.id=i.request_id
        WHERE r.status='RESOLVING' AND i.state IN ('PENDING','ABORTING')
        ORDER BY i.created_at,i.id LIMIT 100`,
      ) as RecoveryIntent[];
      for (const intent of intents) {
        try {
          if (intent.state === 'PENDING') await this.finalizer.completePending(intent.id);
          else await this.finalizer.abortIntent(intent.id, intent.abort_reason);
        } catch (error) {
          const code = error instanceof AppError ? error.code : 'UNEXPECTED';
          this.logger.warn(`Resolution recovery deferred (${code}) for operation ${intent.id}`);
        }
      }
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'UNEXPECTED';
      this.logger.error(`Resolution recovery scan failed (${code})`);
    } finally {
      if (locked) await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [jobName]).catch(() => undefined);
      await runner.release().catch(() => undefined);
    }
  }

  private scheduleNext(): void {
    if (!this.active) return;
    const jitter = 0.8 + Math.random() * 0.4;
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => this.scheduleNext());
    }, Math.round(intervalMs * jitter));
    this.timer.unref();
  }
}
