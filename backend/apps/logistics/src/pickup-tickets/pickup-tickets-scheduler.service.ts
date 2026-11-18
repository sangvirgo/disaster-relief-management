import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { JobRunner } from '@c48/technical/persistence/jobs';
import { PickupTicketExpiryService } from './pickup-tickets-expiry.service';

export const PICKUP_TICKET_JOB_CONFIG = Symbol('PICKUP_TICKET_JOB_CONFIG');
export const PICKUP_TICKET_JOB_NAME = 'logistics.pickup-ticket-expiry';
export const PICKUP_TICKET_JOB_INTERVAL_MS = 10 * 60_000;

export interface PickupTicketJobConfig {
  enabled: boolean;
  intervalMs: number;
}

/**
 * C48_PICKUP_TICKET_JOB_ENABLED: unset or "true" runs the expiry sweep every 10 minutes; "false" disables it. Any other
 * value fails startup so a typo cannot silently turn the job off.
 */
export function loadPickupTicketJobConfig(env: Record<string, string | undefined> = process.env): PickupTicketJobConfig {
  const raw = env.C48_PICKUP_TICKET_JOB_ENABLED;
  if (raw !== undefined && raw !== 'true' && raw !== 'false') {
    throw new Error('Invalid backend configuration: C48_PICKUP_TICKET_JOB_ENABLED');
  }
  return { enabled: raw !== 'false', intervalMs: PICKUP_TICKET_JOB_INTERVAL_MS };
}

@Injectable()
export class PickupTicketScheduler implements OnModuleInit, OnModuleDestroy {
  private stop: (() => void) | null = null;

  constructor(
    @Inject(PICKUP_TICKET_JOB_CONFIG) private readonly config: PickupTicketJobConfig,
    private readonly expiry: PickupTicketExpiryService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) return;
    this.stop = new JobRunner(this.dataSource).schedule(
      PICKUP_TICKET_JOB_NAME,
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
