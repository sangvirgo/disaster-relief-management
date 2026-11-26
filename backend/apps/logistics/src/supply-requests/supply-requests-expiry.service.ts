import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { claimBatch, JobRunner } from '@c48/technical/persistence/jobs';
import { loadSupplyLines, loadSupplyRequest, releaseSupplyReservations, requestState, writeSupplyAudit } from './supply-requests.helpers';

export const SUPPLY_REQUEST_JOB_CONFIG = Symbol('SUPPLY_REQUEST_JOB_CONFIG');
export const SUPPLY_REQUEST_JOB_NAME = 'logistics.supply-request-expiry';
export const SUPPLY_REQUEST_JOB_INTERVAL_MS = 5 * 60_000;

export interface SupplyRequestJobConfig {
  enabled: boolean;
  intervalMs: number;
}

/**
 * C48_SUPPLY_REQUEST_JOB_ENABLED: unset or "true" runs the expiry sweep every 5 minutes; "false" disables it. Any other
 * value fails startup so a typo cannot silently turn the job off.
 */
export function loadSupplyRequestJobConfig(env: Record<string, string | undefined> = process.env): SupplyRequestJobConfig {
  const raw = env.C48_SUPPLY_REQUEST_JOB_ENABLED;
  if (raw !== undefined && raw !== 'true' && raw !== 'false') {
    throw new Error('Invalid backend configuration: C48_SUPPLY_REQUEST_JOB_ENABLED');
  }
  return { enabled: raw !== 'false', intervalMs: SUPPLY_REQUEST_JOB_INTERVAL_MS };
}

/**
 * Expires READY requests past their deadline: the reservation goes back to the shelf. A system job has no session, so
 * the RELEASE movements are attributed to the user who made the request; the audit row has a null actor.
 */
@Injectable()
export class SupplyRequestExpiryService {
  async sweep(manager: EntityManager): Promise<number> {
    const claimed = await claimBatch<{ id: string }>(
      manager,
      `SELECT id FROM supply_request WHERE status='READY' AND expires_at <= clock_timestamp() ORDER BY expires_at, id`,
    );
    let expired = 0;
    for (const { id } of claimed) {
      const row = await loadSupplyRequest(manager, id, true);
      if (row.status !== 'READY' || new Date(row.expires_at).getTime() > Date.now()) continue;
      await releaseSupplyReservations(manager, await loadSupplyLines(manager, [id]), row.requested_by, id);
      await manager.query(
        `UPDATE supply_request SET status='EXPIRED',cancelled_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
          WHERE id=$1 AND status='READY'`,
        [id],
      );
      await writeSupplyAudit(manager, null, 'SUPPLY_REQUEST_EXPIRED', id, requestState(row),
        { ...requestState(row), status: 'EXPIRED', version: Number(row.version) + 1 }, 'Hết hạn nhận hàng');
      expired += 1;
    }
    return expired;
  }
}

@Injectable()
export class SupplyRequestScheduler implements OnModuleInit, OnModuleDestroy {
  private stop: (() => void) | null = null;

  constructor(
    @Inject(SUPPLY_REQUEST_JOB_CONFIG) private readonly config: SupplyRequestJobConfig,
    private readonly expiry: SupplyRequestExpiryService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) return;
    this.stop = new JobRunner(this.dataSource).schedule(
      SUPPLY_REQUEST_JOB_NAME,
      this.config.intervalMs,
      (manager) => this.expiry.sweep(manager),
      true,
    );
  }

  onModuleDestroy(): void {
    this.stop?.();
    this.stop = null;
  }
}
