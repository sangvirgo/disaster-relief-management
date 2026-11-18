import { Module } from '@nestjs/common';
import { IdempotencyService } from '@c48/technical/idempotency/idempotency';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { ResponseCampaignModule } from '../integrations/response/response-campaign.module';
import { CampaignWarehousesController } from './campaign-warehouses.controller';
import { CampaignWarehouseService } from './campaign-warehouses.service';

@Module({
  imports: [LogisticsAuthModule, ResponseCampaignModule],
  controllers: [CampaignWarehousesController],
  providers: [IdempotencyService, CampaignWarehouseService],
  exports: [CampaignWarehouseService],
})
export class CampaignWarehouseModule {}
