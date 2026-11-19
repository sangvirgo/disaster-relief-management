import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { JobRunner } from '@c48/technical/persistence/jobs';
import { NeedExtractionSweepService } from './need-extraction-sweep.service';

export const NEED_EXTRACTION_JOB_CONFIG = Symbol('NEED_EXTRACTION_JOB_CONFIG');
export const NEED_EXTRACTION_JOB_NAME = 'logistics.need-extraction-sweep';
export const NEED_EXTRACTION_JOB_INTERVAL_MS = 5 * 60_000;

export interface NeedExtractionJobConfig {
  enabled: boolean;
  intervalMs: number;
}

/**
 * C48_NEED_EXTRACTION_JOB_ENABLED: unset or "true" runs the 5-minute sweep; "false" disables it. Any other value fails
 * startup so a typo cannot silently turn the job off or on.
 */
export function loadNeedExtractionJobConfig(env: Record<string, string | undefined> = process.env): NeedExtractionJobConfig {
  const raw = env.C48_NEED_EXTRACTION_JOB_ENABLED;
  if (raw !== undefined && raw !== 'true' && raw !== 'false') {
    throw new Error('Invalid backend configuration: C48_NEED_EXTRACTION_JOB_ENABLED');
  }
  return { enabled: raw !== 'false', intervalMs: NEED_EXTRACTION_JOB_INTERVAL_MS };
}

/** Runs the sweep through the shared JobRunner: one run at a time across replicas (advisory lock per job name). */
@Injectable()
export class NeedExtractionScheduler implements OnModuleInit, OnModuleDestroy {
  private stop: (() => void) | null = null;

  constructor(
    @Inject(NEED_EXTRACTION_JOB_CONFIG) private readonly config: NeedExtractionJobConfig,
    private readonly sweep: NeedExtractionSweepService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) return;
    this.stop = new JobRunner(this.dataSource).schedule(
      NEED_EXTRACTION_JOB_NAME,
      this.config.intervalMs,
      async () => {
        await this.sweep.runOnce();
      },
      true,
    );
  }

  onModuleDestroy(): void {
    this.stop?.();
    this.stop = null;
  }
}
