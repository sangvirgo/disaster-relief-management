import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res, UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { IdempotencyKeyInterceptor } from '@c48/technical/idempotency/idempotency.interceptor';
import { markIdempotentReplay as replay, noStore } from '@c48/technical/http/response-headers';
import {
  CancelSupplyRequestDto, CreateSupplyRequestDto, HandOverSupplyRequestDto, MissionSupplyQueryDto, SupplyQueueQueryDto,
} from './supply-requests.dto';
import { SupplyRequestCommand } from './supply-requests.helpers';
import { SupplyRequestsQueriesService } from './supply-requests-queries.service';
import { SupplyRequestsService } from './supply-requests.service';

@Controller('supply-requests')
export class SupplyRequestsController {
  constructor(
    private readonly commands: SupplyRequestsService,
    private readonly queries: SupplyRequestsQueriesService,
  ) {}

  /** The team's requests for one mission (leader, members, coordinator). */
  @Get()
  forMission(@Query() query: MissionSupplyQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.forMission(query, request);
  }

  /** Suggested goods for the mission from the SOS needs (AI text extraction, norm estimate, confirmed lines). */
  @Get('suggestion')
  suggestion(@Query() query: MissionSupplyQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.suggestion(query, request);
  }

  /** The warehouse queue: team name and goods only. */
  @Get('queue')
  queue(@Query() query: SupplyQueueQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.queue(query, request);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  create(@Body() dto: CreateSupplyRequestDto, @Req() request: SupplyRequestCommand, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.commandResult(response, this.commands.create(dto, request));
  }

  @Post(':id/hand-over')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  handOver(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: HandOverSupplyRequestDto,
    @Req() request: SupplyRequestCommand,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.handOver(id, dto, request));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  cancel(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: CancelSupplyRequestDto,
    @Req() request: SupplyRequestCommand,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.cancel(id, dto, request));
  }

  private async commandResult(response: Response, result: Promise<IdempotentResult<Record<string, unknown>>>): Promise<Record<string, unknown>> {
    const outcome = await result;
    replay(response, outcome.replay);
    return outcome.value;
  }
}
