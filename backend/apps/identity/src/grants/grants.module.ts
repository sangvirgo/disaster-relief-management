import { Module } from '@nestjs/common';
import { AdminSecurityModule } from '../admin/admin-security.module';
import { CampaignScopeService } from './campaign-scope.service';
import { GrantsController } from './grants.controller';
import { GrantsService } from './grants.service';

@Module({
  imports: [AdminSecurityModule],
  controllers: [GrantsController],
  providers: [GrantsService, CampaignScopeService],
})
export class GrantsModule {}
