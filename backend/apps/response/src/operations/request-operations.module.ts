import { Module } from '@nestjs/common';
import { RequestIntakeModule } from '../requests/request-intake.module';
import { RequestOperationsController } from './request-operations.controller';
import { RequestOperationsService } from './request-operations.service';
import { REQUEST_OPERATIONS_CONFIG } from './request-operations.config';
import { RequestOperationsOverdueSchedulerService } from './request-operations.overdue-scheduler.service';
import { RequestOperationsPersistenceService } from './request-operations.persistence.service';
import { RequestOperationsQueriesService } from './request-operations.queries.service';
import { RequestOperationsCommandRunner } from './request-operations.command-runner.service';
import { RequestOperationsTriageService } from './request-operations.triage.service';
import { RequestOperationsDedupReferralService } from './request-operations.dedup-referral.service';
import { RequestOperationsVerificationService } from './request-operations.verification.service';
import { RequestOperationsSupplementReviewService } from './request-operations.supplement-review.service';

@Module({
  imports: [RequestIntakeModule],
  controllers: [RequestOperationsController],
  providers: [
    { provide: REQUEST_OPERATIONS_CONFIG, useFactory: () => RequestOperationsService.config() },
    RequestOperationsService,
    RequestOperationsOverdueSchedulerService,
    RequestOperationsPersistenceService,
    RequestOperationsQueriesService,
    RequestOperationsCommandRunner,
    RequestOperationsTriageService,
    RequestOperationsDedupReferralService,
    RequestOperationsVerificationService,
    RequestOperationsSupplementReviewService,
  ],
  exports: [RequestOperationsService],
})
export class RequestOperationsModule {}
