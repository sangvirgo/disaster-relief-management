import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { CircuitBreakerClient } from '../../../../packages/technical/src/http/service-client';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { IDENTITY_SERVICE_TOKEN_CONFIG, issueServiceToken, ServiceTokenConfig } from '../auth/service-tokens';
import { Inject } from '@nestjs/common';

@Injectable()
export class CampaignScopeService implements OnModuleDestroy {
  private readonly client: CircuitBreakerClient;

  constructor(@Inject(IDENTITY_SERVICE_TOKEN_CONFIG) private readonly config: ServiceTokenConfig) {
    this.client = new CircuitBreakerClient(`${process.env.RESPONSE_BASE_URL ?? 'http://response-api:3002'}/`, 'RESPONSE_UNAVAILABLE');
  }

  async assertActiveCampaign(campaignId: string, organizationId: string): Promise<void> {
    const identity = this.config.clients.identity;
    if (!identity) throw new AppError('INTERNAL_ERROR', { status: 500 });
    const token = issueServiceToken(this.config, 'identity', identity.secret, 'response');
    const response = await this.client.get<{ id: string; organization_id: string; status: string }>(
      `/api/v1/response/internal/campaigns/${campaignId}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (response.status === 404) throw new AppError('NOT_FOUND', { status: 404 });
    if (response.status !== 200) throw new AppError('RESPONSE_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
    const campaign = response.body;
    if (!campaign || typeof campaign !== 'object' || typeof campaign.id !== 'string' ||
        typeof campaign.organization_id !== 'string' || typeof campaign.status !== 'string') {
      throw new AppError('RESPONSE_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
    }
    if (campaign.id !== campaignId || campaign.organization_id !== organizationId || campaign.status !== 'ACTIVE') {
      throw new AppError('SCOPE_INVALID', { status: 400 });
    }
  }

  onModuleDestroy(): void {
    this.client.close();
  }
}
