import { Module } from '@nestjs/common';
import { IdempotencyService } from '@c48/technical/idempotency/idempotency';
import { IdempotencyKeyInterceptor } from '@c48/technical/idempotency/idempotency.interceptor';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { ResponseCampaignModule } from '../integrations/response/response-campaign.module';
import { NeedsModule } from '../needs/needs.module';
import { SupplyRequestsController } from './supply-requests.controller';
import {
  loadSupplyRequestJobConfig, SUPPLY_REQUEST_JOB_CONFIG, SupplyRequestExpiryService, SupplyRequestScheduler,
} from './supply-requests-expiry.service';
import { SupplyRequestsQueriesService } from './supply-requests-queries.service';
import { SupplyRequestsService } from './supply-requests.service';

@Module({
  imports: [LogisticsAuthModule, ResponseCampaignModule, NeedsModule],
  controllers: [SupplyRequestsController],
  providers: [
    IdempotencyService,
    IdempotencyKeyInterceptor,
    SupplyRequestsService,
    SupplyRequestsQueriesService,
    SupplyRequestExpiryService,
    { provide: SUPPLY_REQUEST_JOB_CONFIG, useFactory: () => loadSupplyRequestJobConfig() },
    SupplyRequestScheduler,
  ],
})
export class SupplyRequestsModule {}
