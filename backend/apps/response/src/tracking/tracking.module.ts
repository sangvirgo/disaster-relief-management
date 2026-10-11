import { Module } from '@nestjs/common';
import { RequestIntakeModule } from '../requests/request-intake.module';
import { loadReporterSessionConfig, REPORTER_SESSION_CONFIG, ReporterSessionService } from '../requests/reporter-session';
import { ReporterAccessService } from './reporter-access.service';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

@Module({
  imports: [RequestIntakeModule],
  controllers: [TrackingController],
  providers: [
    { provide: REPORTER_SESSION_CONFIG, useFactory: () => loadReporterSessionConfig() },
    ReporterSessionService,
    ReporterAccessService,
    TrackingService,
  ],
  exports: [ReporterAccessService, ReporterSessionService, TrackingService],
})
export class TrackingModule {}
