import { Module } from '@nestjs/common';
import { CircuitBreakerClient } from '@c48/technical/http/service-client';
import { LogisticsAuthModule } from '../../auth/logistics-auth.module';
import {
  LOGISTICS_RESPONSE_CLIENT, LogisticsResponseCampaignClient, loadResponseCampaignConfig,
  RESPONSE_CAMPAIGN_CONFIG,
} from './response-campaign.client';
import { LogisticsResponseMissionClient } from './response-mission.client';
import { LogisticsResponseSupplyCandidatesClient } from './response-supply-candidates.client';

@Module({
  imports: [LogisticsAuthModule],
  providers: [
    LogisticsResponseCampaignClient,
    LogisticsResponseMissionClient,
    LogisticsResponseSupplyCandidatesClient,
    { provide: RESPONSE_CAMPAIGN_CONFIG, useFactory: () => loadResponseCampaignConfig() },
    {
      provide: LOGISTICS_RESPONSE_CLIENT,
      inject: [RESPONSE_CAMPAIGN_CONFIG],
      useFactory: (config: ReturnType<typeof loadResponseCampaignConfig>) =>
        new CircuitBreakerClient(config.baseUrl, 'RESPONSE_UNAVAILABLE', { timeoutMs: config.timeoutMs, maxSockets: 10 }),
    },
  ],
  exports: [LogisticsResponseCampaignClient, LogisticsResponseMissionClient, LogisticsResponseSupplyCandidatesClient],
})
export class ResponseCampaignModule {}
