import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule, postgresOptions } from '../../../packages/technical/src';
import { InitialResponse1710000000000 } from './database/migrations/InitialResponse1710000000000';
import { AddRequestSourceIpIndex1710000000001 } from './database/migrations/AddRequestSourceIpIndex1710000000001';
import { AddEvidenceUploadIpQuota1710000000002 } from './database/migrations/AddEvidenceUploadIpQuota1710000000002';
import { RequestIntakeModule } from './requests/request-intake.module';
import { TrackingModule } from './tracking/tracking.module';
import { EvidenceModule } from './evidence/evidence.module';
import { RequestOperationsModule } from './operations/request-operations.module';
import { TeamsModule } from './teams/teams.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(postgresOptions([InitialResponse1710000000000, AddRequestSourceIpIndex1710000000001, AddEvidenceUploadIpQuota1710000000002], 'response')),
    HealthModule,
    RequestIntakeModule,
    TrackingModule,
    EvidenceModule,
    RequestOperationsModule,
    TeamsModule,
  ],
})
export class AppModule {}
