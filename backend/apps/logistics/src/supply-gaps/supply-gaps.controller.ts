import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res, UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IdempotencyKeyInterceptor } from '@c48/technical/idempotency/idempotency.interceptor';
import { noStore, markIdempotentReplay as replay } from '@c48/technical/http/response-headers';
import { AcceptSupplyGapDto, DismissSupplyGapDto, SupplyGapQueryDto } from './supply-gaps.dto';
import { SupplyGapCommandRequest, SupplyGapsService } from './supply-gaps.service';
import { SupplyGapQueriesService } from './supply-gap-queries.service';

@Controller('supply-gaps')
export class SupplyGapsController {
  constructor(
    private readonly gaps: SupplyGapsService,
    private readonly queries: SupplyGapQueriesService,
  ) {}

  @Get()
  list(@Query() query: SupplyGapQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.list(query, request);
  }

  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.detail(id, request);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async accept(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: AcceptSupplyGapDto,
    @Req() request: SupplyGapCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.gaps.accept(id, dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post(':id/dismiss')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async dismiss(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: DismissSupplyGapDto,
    @Req() request: SupplyGapCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.gaps.dismiss(id, dto, request);
    replay(response, result.replay);
    return result.value;
  }
}
