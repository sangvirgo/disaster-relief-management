import { Module } from '@nestjs/common';
import { RequestIntakeModule } from '../requests/request-intake.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignCoordinationService } from './campaign-coordination.service';
import { ResponseServiceTokenGuard } from './service-token.guard';

@Module({
  imports: [RequestIntakeModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignCoordinationService, ResponseServiceTokenGuard],
})
export class CampaignsModule {}
