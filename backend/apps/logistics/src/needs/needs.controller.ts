import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '@c48/technical/errors/errors';
import { IdempotencyKeyInterceptor } from '@c48/technical/idempotency/idempotency.interceptor';
import type { IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { LogisticsServiceTokenGuard } from '../auth/logistics-service-token.guard';
import {
  AdjustNeedQuantityDto, CancelNeedDto, ConfirmNeedDto, CreateNeedCommitmentDto, CreateNeedDto, EstimateNeedsDto, FulfillmentQueryDto,
  NeedContributionsQueryDto, NeedNormPatchDto, NeedsListQueryDto, ReleaseCommitmentDto,
} from './needs.dto';
import { NeedCommandsService } from './need-commands.service';
import { NeedCommitmentsService } from './need-commitments.service';
import { NeedNormsService } from './need-norms.service';
import { NeedCommandRequest } from './needs.helpers';
import { NeedsQueriesService } from './needs-queries.service';
import { NeedsService } from './needs.service';
import { UnaccountedGoodsGuard } from '../pickup-tickets/unaccounted-goods.service';
import { noStore } from '@c48/technical/http/response-headers';

function actorRequest(request: Request): Request {
  const header = request.headers['x-actor-authorization'];
  const authorization = Array.isArray(header) ? header[0] : header;
  if (!authorization?.match(/^Bearer [A-Za-z0-9_.-]+$/iu)) {
    throw new AppError('UNAUTHENTICATED', { status: 401 });
  }
  return { method: 'GET', headers: { authorization } } as Request;
}

@Controller()
export class NeedsController {
  constructor(
    private readonly needs: NeedsService,
    private readonly commands: NeedCommandsService,
    private readonly commitments: NeedCommitmentsService,
    private readonly queries: NeedsQueriesService,
    private readonly norms: NeedNormsService,
    private readonly unaccountedGoods: UnaccountedGoodsGuard,
  ) {}

  @Get('needs')
  list(@Query() query: NeedsListQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.list(query, request);
  }

  @Get('requests/:requestId/fulfillment')
  fulfillment(
    @Param('requestId', new ParseUUIDPipe({ version: 'all' })) requestId: string,
    @Query() query: FulfillmentQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.queries.fulfillment(requestId, query, request);
  }

  @Get('internal/requests/:requestId/fulfillment')
  @UseGuards(LogisticsServiceTokenGuard)
  async internalFulfillment(
    @Param('requestId', new ParseUUIDPipe({ version: 'all' })) requestId: string,
    @Query() query: FulfillmentQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    // Response calls this read before it creates a resolution intent: refuse while goods on a HANDED_OVER pickup are unaccounted.
    await this.unaccountedGoods.assertRequestResolvable(requestId);
    return this.queries.fulfillment(requestId, query, actorRequest(request));
  }

  @Get('needs/:id/contributions')
  contributions(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) needId: string,
    @Query() query: NeedContributionsQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.queries.contributions(needId, query, request);
  }

  @Post('needs')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async create(
    @Body() dto: CreateNeedDto,
    @Req() request: NeedCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    const result = await this.needs.create(dto, request);
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }

  @Post('needs/:id/increase')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  increase(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: AdjustNeedQuantityDto,
    @Req() request: NeedCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.increase(id, dto, request));
  }

  @Post('needs/:id/reduce')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  reduce(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: AdjustNeedQuantityDto,
    @Req() request: NeedCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.reduce(id, dto, request));
  }

  @Post('needs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  cancel(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: CancelNeedDto,
    @Req() request: NeedCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.cancel(id, dto, request));
  }

  @Post('needs/:id/commitments')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  createCommitment(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: CreateNeedCommitmentDto,
    @Req() request: NeedCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commitments.create(id, dto, request));
  }

  @Post('commitments/:id/release')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  releaseCommitment(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: ReleaseCommitmentDto,
    @Req() request: NeedCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commitments.release(id, dto, request));
  }

  @Post('needs/estimate')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async estimate(
    @Body() dto: EstimateNeedsDto,
    @Req() request: NeedCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    const result = await this.needs.estimate(dto, request);
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }

  @Post('needs/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  confirm(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: ConfirmNeedDto,
    @Req() request: NeedCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.confirm(id, dto, request));
  }

  @Get('need-norms')
  listNorms(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.norms.list(request);
  }

  @Patch('need-norms/:id')
  updateNorm(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: NeedNormPatchDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.norms.update(id, dto, request);
  }

  private async commandResult(
    response: Response,
    result: Promise<IdempotentResult<Record<string, unknown>>>,
  ): Promise<Record<string, unknown>> {
    const outcome = await result;
    if (outcome.replay) response.setHeader('Idempotent-Replay', 'true');
    return outcome.value;
  }
}
