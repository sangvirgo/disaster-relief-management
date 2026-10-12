import { Module } from '@nestjs/common';
import { RequestIntakeModule } from '../requests/request-intake.module';
import { loadMissionsConfig, MISSIONS_CONFIG } from '../missions/missions.config';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [RequestIntakeModule],
  controllers: [ReportsController],
  providers: [
    { provide: MISSIONS_CONFIG, useFactory: () => loadMissionsConfig() },
    ReportsService,
  ],
})
export class ReportsModule {}
