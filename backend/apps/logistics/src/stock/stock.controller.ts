import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { StockQueriesService } from './stock-queries.service';
import {
  CreateStockAdjustmentDto, OpeningStockDto, ReviewStockAdjustmentDto, StockAdjustmentListQueryDto,
  StockListQueryDto, StockPageQueryDto,
} from './stock.dto';
import { StockService } from './stock.service';

type StockRequest = Request & { idempotencyKey?: string };

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

function replay(response: Response, value: boolean): void {
  if (value) response.setHeader('Idempotent-Replay', 'true');
}

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService, private readonly queries: StockQueriesService) {}

  @Get()
  balances(@Query() query: StockListQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.balances(query, request);
  }

  @Get('adjustments')
  adjustments(@Query() query: StockAdjustmentListQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.adjustments(query, request);
  }

  @Get(':balanceId/movements')
  movements(
    @Param('balanceId', new ParseUUIDPipe({ version: 'all' })) balanceId: string,
    @Query() query: StockPageQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.queries.movements(balanceId, query, request);
  }

  @Post('opening')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async opening(@Body() dto: OpeningStockDto, @Req() request: StockRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.stock.opening(dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('adjustments')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async createAdjustment(@Body() dto: CreateStockAdjustmentDto, @Req() request: StockRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.stock.createAdjustment(dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('adjustments/:id/review')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async reviewAdjustment(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: ReviewStockAdjustmentDto,
    @Req() request: StockRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.stock.reviewAdjustment(id, dto, request);
    replay(response, result.replay);
    return result.value;
  }
}
