import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../../../packages/technical/src/idempotency/idempotency';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { ResponseCampaignModule } from '../integrations/response/response-campaign.module';
import { DistributionCommandsService } from './distribution-commands.service';
import { DistributionQueriesService } from './distribution-queries.service';
import { DistributionsController } from './distributions.controller';
import { HandoffCommandsService } from './handoff-commands.service';

@Module({
  imports: [LogisticsAuthModule, ResponseCampaignModule],
  controllers: [DistributionsController],
  providers: [DistributionCommandsService, DistributionQueriesService, HandoffCommandsService, IdempotencyService, IdempotencyKeyInterceptor],
})
export class DistributionsModule {}
