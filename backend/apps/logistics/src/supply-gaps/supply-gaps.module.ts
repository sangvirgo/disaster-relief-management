import { Module } from '@nestjs/common';
import { IdempotencyService } from '@c48/technical/idempotency/idempotency';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { CampaignWarehouseModule } from '../campaign-warehouses/campaign-warehouses.module';
import { ResponseCampaignModule } from '../integrations/response/response-campaign.module';
import { DrivesModule } from '../drives/drives.module';
import { SupplyGapQueriesService } from './supply-gap-queries.service';
import { loadSupplyGapJobConfig, SUPPLY_GAP_JOB_CONFIG, SupplyGapScheduler } from './supply-gap-scheduler.service';
import { SupplyGapsController } from './supply-gaps.controller';
import { SupplyGapsService } from './supply-gaps.service';

@Module({
  imports: [LogisticsAuthModule, ResponseCampaignModule, CampaignWarehouseModule, DrivesModule],
  controllers: [SupplyGapsController],
  providers: [
    IdempotencyService,
    SupplyGapsService,
    SupplyGapQueriesService,
    { provide: SUPPLY_GAP_JOB_CONFIG, useFactory: () => loadSupplyGapJobConfig() },
    SupplyGapScheduler,
  ],
  exports: [SupplyGapsService],
})
export class SupplyGapsModule {}
