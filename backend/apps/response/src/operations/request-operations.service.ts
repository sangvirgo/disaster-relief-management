import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { IdempotentResult } from '../../../../packages/technical/src/idempotency/idempotency';
import type { ReporterSession } from '../requests/reporter-session';
import type {
  AuthorityReferralDto, ContactAttemptDto, ConcurRequestDto, CorrectRegionDto, DuplicateRequestDto,
  RejectRequestDto, RequestQueueQueryDto, RequestOperationPageDto, RequestVersionDto,
  SupplementReviewDto, TriageRequestDto, VerifyRequestDto,
} from './request-operations.dto';
import { loadOperationsConfig } from './request-operations.helpers';
import type { RequestOperationsConfig } from './request-operations.types';
import { RequestOperationsQueriesService } from './request-operations.queries.service';
import { RequestOperationsVerificationService } from './request-operations.verification.service';
import { RequestOperationsSupplementReviewService } from './request-operations.supplement-review.service';
import { RequestOperationsTriageService } from './request-operations.triage.service';
import { RequestOperationsDedupReferralService } from './request-operations.dedup-referral.service';

export { REQUEST_OPERATIONS_CONFIG } from './request-operations.config';
export type { RequestOperationsConfig } from './request-operations.types';

@Injectable()
export class RequestOperationsService {
  constructor(
    private readonly queries: RequestOperationsQueriesService,
    private readonly verification: RequestOperationsVerificationService,
    private readonly supplementReview: RequestOperationsSupplementReviewService,
    private readonly triageService: RequestOperationsTriageService,
    private readonly dedupReferral: RequestOperationsDedupReferralService,
  ) {}

  static config(): RequestOperationsConfig { return loadOperationsConfig(); }

  async queue(query: RequestQueueQueryDto, request: Request): Promise<Record<string, unknown>> {
    return this.queries.queue(query, request);
  }

  async unassigned(query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    return this.queries.unassigned(query, request);
  }

  async detail(requestId: string, request: Request): Promise<Record<string, unknown>> {
    return this.queries.detail(requestId, request);
  }

  async events(requestId: string, query: RequestOperationPageDto, request: Request, sessionOverride?: ReporterSession): Promise<Record<string, unknown>> {
    return this.queries.events(requestId, query, request, sessionOverride);
  }

  async contactAttempts(requestId: string, query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    return this.queries.contactAttempts(requestId, query, request);
  }

  async duplicates(requestId: string, query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    return this.queries.duplicates(requestId, query, request);
  }

  async evidence(requestId: string, query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    return this.queries.evidence(requestId, query, request);
  }

  async missions(requestId: string, query: RequestOperationPageDto, request: Request): Promise<Record<string, unknown>> {
    return this.queries.missions(requestId, query, request);
  }

  async duplicateCandidates(requestId: string, request: Request): Promise<Record<string, unknown>> {
    return this.queries.duplicateCandidates(requestId, request);
  }

  async verificationCandidates(requestId: string, request: Request): Promise<Record<string, unknown>> {
    return this.queries.verificationCandidates(requestId, request);
  }

  async startVerification(requestId: string, dto: RequestVersionDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.verification.startVerification(requestId, dto, key, request);
  }

  async addContactAttempt(requestId: string, dto: ContactAttemptDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.verification.addContactAttempt(requestId, dto, key, request);
  }

  async verify(requestId: string, dto: VerifyRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.verification.verify(requestId, dto, key, request);
  }

  async concur(requestId: string, dto: ConcurRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.verification.concur(requestId, dto, key, request);
  }

  async reject(requestId: string, dto: RejectRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.verification.reject(requestId, dto, key, request);
  }

  async duplicate(requestId: string, dto: DuplicateRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.dedupReferral.duplicate(requestId, dto, key, request);
  }

  async triage(requestId: string, dto: TriageRequestDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.triageService.triage(requestId, dto, key, request);
  }

  async authorityReferral(requestId: string, dto: AuthorityReferralDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.dedupReferral.authorityReferral(requestId, dto, key, request);
  }

  async correctRegion(requestId: string, dto: CorrectRegionDto, key: string, request: Request): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.dedupReferral.correctRegion(requestId, dto, key, request);
  }

  async reviewSupplement(
    requestId: string, eventId: string, dto: SupplementReviewDto, key: string, request: Request,
  ): Promise<IdempotentResult<Record<string, unknown>>> {
    return this.supplementReview.reviewSupplement(requestId, eventId, dto, key, request);
  }
}
