import { Module } from '@nestjs/common';
import { RequestIntakeModule } from '../requests/request-intake.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignCoordinationService } from './campaign-coordination.service';
import { ResponseServiceTokenGuard } from './service-token.guard';
import { loadLogisticsCycleConfig, LOGISTICS_CYCLE_CONFIG } from '../integrations/logistics/logistics-cycle.client';
import { LogisticsCampaignWarehouseNotifier } from '../integrations/logistics/logistics-campaign-warehouse.client';

@Module({
  imports: [RequestIntakeModule],
  controllers: [CampaignsController],
  providers: [
    CampaignsService, CampaignCoordinationService, ResponseServiceTokenGuard,
    { provide: LOGISTICS_CYCLE_CONFIG, useFactory: () => loadLogisticsCycleConfig() },
    LogisticsCampaignWarehouseNotifier,
  ],
})
export class CampaignsModule {}
