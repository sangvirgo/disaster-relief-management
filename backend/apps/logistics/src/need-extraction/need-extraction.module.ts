import { Module } from '@nestjs/common';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { ResponseCampaignModule } from '../integrations/response/response-campaign.module';
import { CampaignWarehouseModule } from '../campaign-warehouses/campaign-warehouses.module';
import {
  loadNeedExtractionJobConfig, NEED_EXTRACTION_JOB_CONFIG, NeedExtractionScheduler,
} from './need-extraction-scheduler.service';
import { NeedExtractionSweepService } from './need-extraction-sweep.service';
import { NeedProposalsController } from './need-proposals.controller';
import { NeedProposalsService } from './need-proposals.service';

@Module({
  imports: [LogisticsAuthModule, ResponseCampaignModule, CampaignWarehouseModule],
  controllers: [NeedProposalsController],
  providers: [
    NeedExtractionSweepService,
    NeedExtractionScheduler,
    NeedProposalsService,
    { provide: NEED_EXTRACTION_JOB_CONFIG, useFactory: () => loadNeedExtractionJobConfig() },
  ],
  exports: [NeedExtractionSweepService],
})
export class NeedExtractionModule {}
