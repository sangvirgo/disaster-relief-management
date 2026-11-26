import { Module } from '@nestjs/common';
import { IdempotencyService } from '@c48/technical/idempotency/idempotency';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { ResponseCampaignModule } from '../integrations/response/response-campaign.module';
import { LogisticsServiceTokenGuard } from '../auth/logistics-service-token.guard';
import { CampaignWarehousesController } from './campaign-warehouses.controller';
import { CampaignWarehousesInternalController } from './campaign-warehouses-internal.controller';
import { CampaignWarehouseService } from './campaign-warehouses.service';

@Module({
  imports: [LogisticsAuthModule, ResponseCampaignModule],
  controllers: [CampaignWarehousesController, CampaignWarehousesInternalController],
  providers: [IdempotencyService, CampaignWarehouseService, LogisticsServiceTokenGuard],
  exports: [CampaignWarehouseService],
})
export class CampaignWarehouseModule {}
