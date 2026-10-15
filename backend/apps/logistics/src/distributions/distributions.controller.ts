import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import type { IdempotentResult } from '../../../../packages/technical/src/idempotency/idempotency';
import { HandoffAttachmentsService } from './handoff-attachments.service';
import {
  CreateDistributionDto, CreateHandoffDto, DistributionListQueryDto, ExpectedDistributionVersionDto,
  ReplaceDistributionLinesDto, ReviewLossDto,
} from './distributions.dto';
import { DistributionCommandsService } from './distribution-commands.service';
import { DistributionQueriesService } from './distribution-queries.service';
import { HandoffCommandsService } from './handoff-commands.service';

type DistributionCommandRequest = Request & { idempotencyKey?: string };

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

function replay(response: Response, isReplay: boolean): void {
  if (isReplay) response.setHeader('Idempotent-Replay', 'true');
}

@Controller('distributions')
export class DistributionsController {
  constructor(
    private readonly commands: DistributionCommandsService,
    private readonly handoffs: HandoffCommandsService,
    private readonly queries: DistributionQueriesService,
    private readonly attachments: HandoffAttachmentsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async create(
    @Body() dto: CreateDistributionDto,
    @Req() request: DistributionCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    return this.commandResult(response, this.commands.create(dto, request));
  }

  @Get()
  list(
    @Query() query: DistributionListQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.queries.list(query, request);
  }

  @Get(':id')
  detail(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.queries.detail(id, request);
  }

  @Put(':id/lines')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  replaceLines(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: ReplaceDistributionLinesDto,
    @Req() request: DistributionCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.replaceLines(id, dto, request));
  }

  @Post(':id/prepare-from-commitments')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  prepareFromCommitments(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: ExpectedDistributionVersionDto,
    @Req() request: DistributionCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.prepareFromCommitments(id, dto, request));
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  approve(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: ExpectedDistributionVersionDto,
    @Req() request: DistributionCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.approve(id, dto, request));
  }

  @Post(':id/dispatch')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  dispatch(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: ExpectedDistributionVersionDto,
    @Req() request: DistributionCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.dispatch(id, dto, request));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  cancel(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: ExpectedDistributionVersionDto,
    @Req() request: DistributionCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.cancel(id, dto, request));
  }

  @Post(':id/handoffs')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  createHandoff(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: CreateHandoffDto,
    @Req() request: DistributionCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.handoffs.create(id, dto, request));
  }

  @Get(':id/handoffs/:handoffId')
  handoffDetail(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Param('handoffId', new ParseUUIDPipe({ version: 'all' })) handoffId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.queries.handoffDetail(id, handoffId, request);
  }

  @Post(':id/handoffs/:handoffId/evidence')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  uploadHandoffEvidence(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Param('handoffId', new ParseUUIDPipe({ version: 'all' })) handoffId: string,
    @Req() request: DistributionCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.attachments.uploadHandoff(id, handoffId, request));
  }

  @Post(':id/handoffs/:handoffId/review-loss')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  reviewLoss(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Param('handoffId', new ParseUUIDPipe({ version: 'all' })) handoffId: string,
    @Body() dto: ReviewLossDto,
    @Req() request: DistributionCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.handoffs.reviewLoss(id, handoffId, dto, request));
  }

  @Post(':id/reconcile')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  reconcile(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: ExpectedDistributionVersionDto,
    @Req() request: DistributionCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.handoffs.reconcile(id, dto, request));
  }

  private async commandResult(
    response: Response,
    result: Promise<IdempotentResult<Record<string, unknown>>>,
  ): Promise<Record<string, unknown>> {
    const outcome = await result;
    replay(response, outcome.replay);
    return outcome.value;
  }
}
