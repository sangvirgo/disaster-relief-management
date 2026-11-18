import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { IdempotentResult } from '@c48/technical/idempotency/idempotency';
import { IdempotencyKeyInterceptor } from '@c48/technical/idempotency/idempotency.interceptor';
import { noStore, markIdempotentReplay as replay } from '@c48/technical/http/response-headers';
import {
  CancelPickupTicketDto, CreatePickupTicketDto, HandoverPickupTicketDto, PickupExpectedVersionDto, PickupTicketListQueryDto,
} from './pickup-tickets.dto';
import { DeliverPickupGoodsDto, ReviewCloseoutDto, SaveCloseoutDto } from './pickup-goods.dto';
import { PickupRequest } from './pickup-tickets.helpers';
import { PickupGoodsService } from './pickup-goods.service';
import { PickupTicketsService } from './pickup-tickets.service';
import { PickupTicketsQueriesService } from './pickup-tickets-queries.service';

@Controller('pickup-tickets')
export class PickupTicketsController {
  constructor(
    private readonly commands: PickupTicketsService,
    private readonly queries: PickupTicketsQueriesService,
    private readonly goods: PickupGoodsService,
  ) {}

  @Get()
  list(@Query() query: PickupTicketListQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.list(query, request);
  }

  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.detail(id, request);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  create(@Body() dto: CreatePickupTicketDto, @Req() request: PickupRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.commandResult(response, this.commands.create(dto, request));
  }

  @Post(':id/reserve')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  reserve(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: PickupExpectedVersionDto,
    @Req() request: PickupRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.reserve(id, dto, request));
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  confirm(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: PickupExpectedVersionDto,
    @Req() request: PickupRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.confirm(id, dto, request));
  }

  @Post(':id/handover')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  handover(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: HandoverPickupTicketDto,
    @Req() request: PickupRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.handover(id, dto, request));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  cancel(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: CancelPickupTicketDto,
    @Req() request: PickupRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.cancel(id, dto, request));
  }

  @Post(':id/deliveries')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  deliveries(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: DeliverPickupGoodsDto,
    @Req() request: PickupRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.goods.deliver(id, dto, request));
  }

  @Get(':id/closeout')
  closeout(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.goods.closeout(id, request);
  }

  @Put(':id/closeout')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  saveCloseout(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: SaveCloseoutDto,
    @Req() request: PickupRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.goods.saveCloseout(id, dto, request));
  }

  @Post(':id/closeout/submit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  submitCloseout(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: PickupExpectedVersionDto,
    @Req() request: PickupRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.goods.submitCloseout(id, dto, request));
  }

  @Post(':id/closeout/review')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  reviewCloseout(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: ReviewCloseoutDto,
    @Req() request: PickupRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.goods.reviewCloseout(id, dto, request));
  }

  private async commandResult(response: Response, result: Promise<IdempotentResult<Record<string, unknown>>>): Promise<Record<string, unknown>> {
    const outcome = await result;
    replay(response, outcome.replay);
    return outcome.value;
  }
}
