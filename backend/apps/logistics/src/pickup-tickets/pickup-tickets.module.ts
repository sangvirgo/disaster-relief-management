import { Module } from '@nestjs/common';
import { IdempotencyService } from '@c48/technical/idempotency/idempotency';
import { IdempotencyKeyInterceptor } from '@c48/technical/idempotency/idempotency.interceptor';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { DistributionsModule } from '../distributions/distributions.module';
import { NeedsModule } from '../needs/needs.module';
import { ResponseCampaignModule } from '../integrations/response/response-campaign.module';
import { PickupTicketsController } from './pickup-tickets.controller';
import { PickupTicketsQueriesService } from './pickup-tickets-queries.service';
import { PickupTicketsService } from './pickup-tickets.service';
import { PickupGoodsService } from './pickup-goods.service';
import { UnaccountedGoodsGuard } from './unaccounted-goods.service';
import { PickupTicketExpiryService } from './pickup-tickets-expiry.service';
import { loadPickupTicketJobConfig, PICKUP_TICKET_JOB_CONFIG, PickupTicketScheduler } from './pickup-tickets-scheduler.service';

@Module({
  imports: [LogisticsAuthModule, ResponseCampaignModule, NeedsModule, DistributionsModule],
  controllers: [PickupTicketsController],
  providers: [
    IdempotencyService,
    IdempotencyKeyInterceptor,
    PickupTicketsService,
    PickupGoodsService,
    UnaccountedGoodsGuard,
    PickupTicketsQueriesService,
    PickupTicketExpiryService,
    { provide: PICKUP_TICKET_JOB_CONFIG, useFactory: () => loadPickupTicketJobConfig() },
    PickupTicketScheduler,
  ],
})
export class PickupTicketsModule {}
