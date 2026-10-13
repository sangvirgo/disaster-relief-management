import { Module } from '@nestjs/common';
import { RequestIntakeModule } from '../requests/request-intake.module';
import { LogisticsCycleClient, loadLogisticsCycleConfig, LOGISTICS_CYCLE_CONFIG } from '../integrations/logistics/logistics-cycle.client';
import { LogisticsServiceTokenGuard } from './logistics-service-token.guard';
import { RequestResolutionController } from './request-resolution.controller';
import { RequestResolutionFinalizer } from './request-resolution-finalizer.service';
import { RequestResolutionLifecycleService } from './request-resolution-lifecycle.service';
import { RequestResolutionRecoveryService } from './request-resolution-recovery.service';
import { RequestResolutionStateService } from './request-resolution-state.service';
import { RequestFailureReviewService } from './request-failure-review.service';
import { RequestResolutionService } from './request-resolution.service';

@Module({
  imports: [RequestIntakeModule],
  controllers: [RequestResolutionController],
  providers: [
    { provide: LOGISTICS_CYCLE_CONFIG, useFactory: () => loadLogisticsCycleConfig() },
    LogisticsCycleClient,
    LogisticsServiceTokenGuard,
    RequestResolutionFinalizer,
    RequestResolutionLifecycleService,
    RequestResolutionRecoveryService,
    RequestResolutionStateService,
    RequestFailureReviewService,
    RequestResolutionService,
  ],
  exports: [RequestResolutionService, RequestResolutionLifecycleService, RequestFailureReviewService],
})
export class RequestResolutionModule {}
