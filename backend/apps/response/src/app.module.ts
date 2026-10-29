import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule, postgresOptions } from '@c48/technical';
import { InitialResponse1710000000000 } from './database/migrations/InitialResponse1710000000000';
import { AddRequestSourceIpIndex1710000000001 } from './database/migrations/AddRequestSourceIpIndex1710000000001';
import { AddEvidenceUploadIpQuota1710000000002 } from './database/migrations/AddEvidenceUploadIpQuota1710000000002';
import { AddSosFactsAndMissionKind1792953600000 } from './database/migrations/AddSosFactsAndMissionKind1792953600000';
import { AddAiAdvisory1792953600001 } from './database/migrations/AddAiAdvisory1792953600001';
import { AllowAiAdvisoryRetries1793116235000 } from './database/migrations/AllowAiAdvisoryRetries1793116235000';
import { AllowAiAdvisoryRetryAttempts1793117000000 } from './database/migrations/AllowAiAdvisoryRetryAttempts1793117000000';
import { AddAiAdvisoryClaimToken1793122000000 } from './database/migrations/AddAiAdvisoryClaimToken1793122000000';
import { RequestIntakeModule } from './requests/request-intake.module';
import { TrackingModule } from './tracking/tracking.module';
import { EvidenceModule } from './evidence/evidence.module';
import { RequestOperationsModule } from './operations/request-operations.module';
import { TeamsModule } from './teams/teams.module';
import { MissionsModule } from './missions/missions.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { MapModule } from './map/map.module';
import { ReportsModule } from './reports/reports.module';
import { NoticesModule } from './notices/notices.module';
import { RequestResolutionModule } from './resolution/request-resolution.module';
import { AiAdvisoryService } from './ai/ai-advisory.service';

@Module({
  imports: [
    TypeOrmModule.forRoot(postgresOptions([InitialResponse1710000000000, AddRequestSourceIpIndex1710000000001, AddEvidenceUploadIpQuota1710000000002, AddSosFactsAndMissionKind1792953600000, AddAiAdvisory1792953600001, AllowAiAdvisoryRetries1793116235000, AllowAiAdvisoryRetryAttempts1793117000000, AddAiAdvisoryClaimToken1793122000000], 'response')),
    HealthModule,
    RequestIntakeModule,
    TrackingModule,
    EvidenceModule,
    RequestOperationsModule,
    TeamsModule,
    MissionsModule,
    CampaignsModule,
    MapModule,
    ReportsModule,
    NoticesModule,
    RequestResolutionModule,
  ],
  providers: [AiAdvisoryService],
})
export class AppModule {}
