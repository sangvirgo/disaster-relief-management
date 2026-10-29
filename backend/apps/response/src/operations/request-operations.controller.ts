import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res, UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AiAdvisoryReviewDto } from './request-operations.dto';
import { RequestOperationsAiAdvisoryService } from './request-operations.ai-advisory.service';
import { IdempotencyKeyInterceptor } from '@c48/technical/idempotency/idempotency.interceptor';
import {
  AuthorityReferralDto, ContactAttemptDto, ConcurRequestDto, CorrectRegionDto, DuplicateRequestDto,
  AttachCampaignDto, RejectRequestDto, RequestQueueQueryDto, RequestOperationPageDto, RequestVersionDto, TeamCandidatesQueryDto,
  SupplementReviewDto, TriageRequestDto, VerifyRequestDto,
} from './request-operations.dto';
import { RequestOperationsService } from './request-operations.service';
import { noStore, requireIdempotencyKey as key, markIdempotentReplay as replay } from '@c48/technical/http/response-headers';

type OperationRequest = Request & { idempotencyKey?: string };

@Controller()
export class RequestOperationsController {
  constructor(private readonly operations: RequestOperationsService, private readonly aiAdvisory: RequestOperationsAiAdvisoryService) {}

  @Get('requests')
  async queue(@Query() query: RequestQueueQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.operations.queue(query, request);
  }

  @Get('requests/unassigned')
  async unassigned(@Query() query: RequestOperationPageDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.operations.unassigned(query, request);
  }

  @Get('requests/:id/duplicate-candidates')
  async duplicateCandidates(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.operations.duplicateCandidates(id, request);
  }

  @Get('requests/:id/verification-candidates')
  async verificationCandidates(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.operations.verificationCandidates(id, request);
  }

  @Get('requests/:id/contact-attempts')
  async contactAttempts(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Query() query: RequestOperationPageDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.operations.contactAttempts(id, query, request);
  }

  @Get('requests/:id/duplicates')
  async duplicates(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Query() query: RequestOperationPageDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.operations.duplicates(id, query, request);
  }

  @Get('requests/:id/evidence')
  async evidence(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Query() query: RequestOperationPageDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.operations.evidence(id, query, request);
  }

  @Get('requests/:id/missions')
  async missions(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Query() query: RequestOperationPageDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.operations.missions(id, query, request);
  }

  @Get('requests/:id/team-candidates')
  async teamCandidates(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Query() query: TeamCandidatesQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.operations.teamCandidates(id, query, request);
  }

  @Get('requests/:id')
  async detail(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.operations.detail(id, request);
  }

  @Post('requests/:id/ai-advisories/:advisoryId/review')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async reviewAiAdvisory(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Param('advisoryId', new ParseUUIDPipe({ version: 'all' })) advisoryId: string,
    @Body() dto: AiAdvisoryReviewDto,
    @Req() request: OperationRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.aiAdvisory.review(id, advisoryId, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('requests/:id/ai-advisories/:advisoryId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async retryAiAdvisory(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Param('advisoryId', new ParseUUIDPipe({ version: 'all' })) advisoryId: string,
    @Body() dto: RequestVersionDto,
    @Req() request: OperationRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.aiAdvisory.retry(id, advisoryId, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('requests/:id/start-verification')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async startVerification(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: RequestVersionDto, @Req() request: OperationRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.operations.startVerification(id, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('requests/:id/contact-attempts')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async addContactAttempt(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: ContactAttemptDto, @Req() request: OperationRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.operations.addContactAttempt(id, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('requests/:id/verify')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async verify(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: VerifyRequestDto, @Req() request: OperationRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.operations.verify(id, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('requests/:id/concur')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async concur(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: ConcurRequestDto, @Req() request: OperationRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.operations.concur(id, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('requests/:id/reject')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async reject(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: RejectRequestDto, @Req() request: OperationRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.operations.reject(id, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('requests/:id/duplicate')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async duplicate(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: DuplicateRequestDto, @Req() request: OperationRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.operations.duplicate(id, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('requests/:id/triage')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async triage(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: TriageRequestDto, @Req() request: OperationRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.operations.triage(id, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('requests/:id/authority-referrals')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async authorityReferral(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: AuthorityReferralDto, @Req() request: OperationRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.operations.authorityReferral(id, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('requests/:id/correct-region')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async correctRegion(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: CorrectRegionDto, @Req() request: OperationRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.operations.correctRegion(id, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('requests/:id/attach-campaign')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async attachCampaign(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: AttachCampaignDto, @Req() request: OperationRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.operations.attachCampaign(id, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('requests/:id/detach-campaign')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async detachCampaign(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: RequestVersionDto, @Req() request: OperationRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.operations.detachCampaign(id, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('requests/:id/supplements/:eventId/review')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async reviewSupplement(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Param('eventId', new ParseUUIDPipe({ version: 'all' })) eventId: string,
    @Body() dto: SupplementReviewDto,
    @Req() request: OperationRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.operations.reviewSupplement(id, eventId, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }
}
