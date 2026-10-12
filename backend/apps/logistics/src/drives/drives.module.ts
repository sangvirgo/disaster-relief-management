import { Module } from '@nestjs/common';
import { CircuitBreakerClient } from '../../../../packages/technical/src/http/service-client';
import { IdempotencyService } from '../../../../packages/technical/src/idempotency/idempotency';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { DonationsController } from './donations.controller';
import { DonationsQueriesService } from './donations-queries.service';
import { DonationsService } from './donations.service';
import { DonationPhoneThrottle } from './donation-phone-throttle.service';
import { DONATION_SECRET_CONFIG, loadDonationSecretConfig } from './donations.helpers';
import { DriveCampaignSyncService } from './drive-campaign-sync.service';
import { DrivesController } from './drives.controller';
import { DriveQueriesService } from './drives-queries.service';
import { DrivesService } from './drives.service';
import {
  LOGISTICS_RESPONSE_CLIENT, LogisticsResponseCampaignClient, loadResponseCampaignConfig,
  RESPONSE_CAMPAIGN_CONFIG,
} from './response-campaign.client';

@Module({
  imports: [LogisticsAuthModule],
  controllers: [DrivesController, DonationsController],
  providers: [
    IdempotencyService,
    DrivesService,
    DriveQueriesService,
    DonationsService,
    DonationPhoneThrottle,
    DonationsQueriesService,
    DriveCampaignSyncService,
    LogisticsResponseCampaignClient,
    { provide: DONATION_SECRET_CONFIG, useFactory: () => loadDonationSecretConfig() },
    { provide: RESPONSE_CAMPAIGN_CONFIG, useFactory: () => loadResponseCampaignConfig() },
    {
      provide: LOGISTICS_RESPONSE_CLIENT,
      inject: [RESPONSE_CAMPAIGN_CONFIG],
      useFactory: (config: ReturnType<typeof loadResponseCampaignConfig>) =>
        new CircuitBreakerClient(config.baseUrl, 'RESPONSE_UNAVAILABLE', { timeoutMs: config.timeoutMs, maxSockets: 10 }),
    },
  ],
})
export class DrivesModule {}
