import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { CircuitBreakerClient } from '@c48/technical/http/service-client';
import { ReporterSessionService } from '../../requests/reporter-session';
import { LOGISTICS_CYCLE_CONFIG, type LogisticsCycleClientConfig } from './logistics-cycle.client';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Tells Logistics that a campaign became ACTIVE or changed its area, so the primary warehouse is chosen right away
 * instead of on the 15-minute supply-gap sweep. Best effort: the campaign command never waits for or fails on it, and
 * the sweep plus the lazy assignment when proposals are read remain the fallback.
 */
@Injectable()
export class LogisticsCampaignWarehouseNotifier implements OnModuleDestroy {
  private readonly logger = new Logger(LogisticsCampaignWarehouseNotifier.name);
  private readonly client: CircuitBreakerClient;

  constructor(
    @Inject(LOGISTICS_CYCLE_CONFIG) config: LogisticsCycleClientConfig,
    private readonly sessions: ReporterSessionService,
  ) {
    this.client = new CircuitBreakerClient(config.baseUrl, 'LOGISTICS_UNAVAILABLE', { timeoutMs: config.timeoutMs, maxSockets: 5 });
  }

  campaignChanged(campaignId: string): void {
    if (!uuidPattern.test(campaignId)) return;
    void this.send(campaignId);
  }

  onModuleDestroy(): void {
    this.client.close();
  }

  private async send(campaignId: string): Promise<void> {
    try {
      const token = await this.sessions.serviceToken('logistics');
      const result = await this.client.post<unknown>(
        `/api/v1/logistics/internal/campaigns/${encodeURIComponent(campaignId)}/warehouses/sync`, {},
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (result.status !== 200) this.logger.warn({ status: result.status }, 'Campaign warehouse sync was not accepted');
    } catch (error) {
      this.logger.warn({ code: error instanceof Error ? error.name : 'UNKNOWN' }, 'Campaign warehouse sync failed');
    }
  }
}
