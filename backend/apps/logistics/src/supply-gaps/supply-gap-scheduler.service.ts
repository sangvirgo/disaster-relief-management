import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { JobRunner } from '@c48/technical/persistence/jobs';
import { SupplyGapsService } from './supply-gaps.service';

export const SUPPLY_GAP_JOB_CONFIG = Symbol('SUPPLY_GAP_JOB_CONFIG');
export const SUPPLY_GAP_JOB_NAME = 'logistics.supply-gap-recompute';
export const SUPPLY_GAP_JOB_INTERVAL_MS = 15 * 60_000;

export interface SupplyGapJobConfig {
  enabled: boolean;
  intervalMs: number;
}

/**
 * C48_SUPPLY_GAP_JOB_ENABLED: unset or "true" runs the 15-minute recomputation; "false" disables it. Any other value
 * fails startup so a typo cannot silently turn the job off.
 */
export function loadSupplyGapJobConfig(env: Record<string, string | undefined> = process.env): SupplyGapJobConfig {
  const raw = env.C48_SUPPLY_GAP_JOB_ENABLED;
  if (raw !== undefined && raw !== 'true' && raw !== 'false') {
    throw new Error('Invalid backend configuration: C48_SUPPLY_GAP_JOB_ENABLED');
  }
  return { enabled: raw !== 'false', intervalMs: SUPPLY_GAP_JOB_INTERVAL_MS };
}

/** Runs the gap recomputation every 15 minutes through the shared JobRunner (advisory lock per job name). */
@Injectable()
export class SupplyGapScheduler implements OnModuleInit, OnModuleDestroy {
  private stop: (() => void) | null = null;

  constructor(
    @Inject(SUPPLY_GAP_JOB_CONFIG) private readonly config: SupplyGapJobConfig,
    private readonly gaps: SupplyGapsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) return;
    this.stop = new JobRunner(this.dataSource).schedule(
      SUPPLY_GAP_JOB_NAME,
      this.config.intervalMs,
      async () => {
        await this.gaps.recompute();
      },
      true,
    );
  }

  onModuleDestroy(): void {
    this.stop?.();
    this.stop = null;
  }
}
