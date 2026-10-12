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
import { RequestOperationsTeamCandidatesService } from './request-operations.team-candidates.service';
import { RequestAdmissionController } from './request-admission.controller';
import { RequestAdmissionService } from './request-admission.service';
import { ResponseServiceTokenGuard } from '../campaigns/service-token.guard';

@Module({
  imports: [RequestIntakeModule],
  controllers: [RequestOperationsController, RequestAdmissionController],
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
    RequestOperationsTeamCandidatesService,
    RequestAdmissionService,
    ResponseServiceTokenGuard,
  ],
  exports: [RequestOperationsService],
})
export class RequestOperationsModule {}
