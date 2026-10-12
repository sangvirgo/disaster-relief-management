import { Module } from '@nestjs/common';
import { RequestIntakeModule } from '../requests/request-intake.module';
import { RequestOperationsModule } from '../operations/request-operations.module';
import { loadMissionsConfig, MISSIONS_CONFIG } from './missions.config';
import { MissionsCommandsService } from './missions-commands.service';
import { MissionsController } from './missions.controller';
import { MissionsOverdueService } from './missions-overdue.service';
import { MissionsQueriesService } from './missions-queries.service';

@Module({
  imports: [RequestIntakeModule, RequestOperationsModule],
  controllers: [MissionsController],
  providers: [
    { provide: MISSIONS_CONFIG, useFactory: () => loadMissionsConfig() },
    MissionsCommandsService,
    MissionsQueriesService,
    MissionsOverdueService,
  ],
})
export class MissionsModule {}
