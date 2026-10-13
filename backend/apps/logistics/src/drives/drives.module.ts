import { Module } from '@nestjs/common';
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
import { ResponseCampaignModule } from '../integrations/response/response-campaign.module';

@Module({
  imports: [LogisticsAuthModule, ResponseCampaignModule],
  controllers: [DrivesController, DonationsController],
  providers: [
    IdempotencyService,
    DrivesService,
    DriveQueriesService,
    DonationsService,
    DonationPhoneThrottle,
    DonationsQueriesService,
    DriveCampaignSyncService,
    { provide: DONATION_SECRET_CONFIG, useFactory: () => loadDonationSecretConfig() },
  ],
})
export class DrivesModule {}
