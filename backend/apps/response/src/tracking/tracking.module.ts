import { Module } from '@nestjs/common';
import { RequestIntakeModule } from '../requests/request-intake.module';
import { ReporterAccessService } from './reporter-access.service';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

@Module({
  imports: [RequestIntakeModule],
  controllers: [TrackingController],
  providers: [
    ReporterAccessService,
    TrackingService,
  ],
  exports: [ReporterAccessService, TrackingService],
})
export class TrackingModule {}
