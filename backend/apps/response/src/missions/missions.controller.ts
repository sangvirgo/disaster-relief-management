import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res, UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { FailureReviewDto } from '../resolution/request-resolution.dto';
import { RequestFailureReviewService } from '../resolution/request-failure-review.service';
import {
  CreateMissionDto, MissionPageQueryDto, MissionReasonDto, MissionTransitionDto, MissionVersionDto,
  RecordMissionOnBehalfDto,
} from './missions.dto';
import { MissionsCommandsService } from './missions-commands.service';
import { MissionsQueriesService } from './missions-queries.service';

type MissionRequest = Request & { idempotencyKey?: string };

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

function key(request: MissionRequest): string {
  if (!request.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
  return request.idempotencyKey;
}

function replay(response: Response, value: boolean): void {
  if (value) response.setHeader('Idempotent-Replay', 'true');
}

@Controller()
export class MissionsController {
  constructor(
    private readonly commands: MissionsCommandsService,
    private readonly queries: MissionsQueriesService,
    private readonly failureReviews: RequestFailureReviewService,
  ) {}

  @Post('requests/:id/missions')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async offer(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) requestId: string,
    @Body() dto: CreateMissionDto,
    @Req() request: MissionRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.commands.offer(requestId, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Get('missions/mine')
  async mine(@Query() query: MissionPageQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.mine(query, request);
  }

  @Get('missions/overdue-offers')
  async overdueOffers(@Query() query: MissionPageQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.overdueOffers(query, request);
  }

  @Get('missions/:id')
  async detail(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) missionId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.queries.detail(missionId, request);
  }

  @Post('missions/:id/accept')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async accept(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) missionId: string,
    @Body() dto: MissionVersionDto,
    @Req() request: MissionRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.commands.accept(missionId, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('missions/:id/decline')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async decline(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) missionId: string,
    @Body() dto: MissionReasonDto,
    @Req() request: MissionRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.commands.decline(missionId, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('missions/:id/transition')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async transition(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) missionId: string,
    @Body() dto: MissionTransitionDto,
    @Req() request: MissionRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.commands.transition(missionId, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('missions/:id/record-on-behalf')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async recordOnBehalf(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) missionId: string,
    @Body() dto: RecordMissionOnBehalfDto,
    @Req() request: MissionRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.commands.recordOnBehalf(missionId, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('missions/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async cancel(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) missionId: string,
    @Body() dto: MissionReasonDto,
    @Req() request: MissionRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.commands.cancel(missionId, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('missions/:id/fail')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async fail(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) missionId: string,
    @Body() dto: MissionReasonDto,
    @Req() request: MissionRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.commands.fail(missionId, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('missions/:id/review-failure')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async reviewFailure(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) missionId: string,
    @Body() dto: FailureReviewDto,
    @Req() request: MissionRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.failureReviews.review(missionId, dto, key(request), request);
    replay(response, result.replay);
    return result.value;
  }
}
