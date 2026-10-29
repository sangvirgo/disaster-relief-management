import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res, UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IdempotencyKeyInterceptor } from '@c48/technical/idempotency/idempotency.interceptor';
import {
  CreateDonationReceiptDto, DonationDisputePageQueryDto,
  PostDonationReceiptDto, RecordReceiptCountDto, ReleaseHeldDonationDto, ResolveDonationDisputeDto,
  ReviewDonationReceiptDto,
} from './donation-receipts.dto';
import { DonationPageQueryDto } from '../drives/donations.dto';
import { DonationReceiptsQueriesService } from './donation-receipts-queries.service';
import { DonationReceiptsService } from './donation-receipts.service';
import { noStore, markIdempotentReplay as replay } from '@c48/technical/http/response-headers';

type ReceiptCommandRequest = Request & { idempotencyKey?: string };

@Controller()
export class DonationReceiptsController {
  constructor(
    private readonly receipts: DonationReceiptsService,
    private readonly queries: DonationReceiptsQueriesService,
  ) {}

  @Get('donation-deliveries')
  deliveries(@Query() query: DonationPageQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.deliveries(query, request);
  }

  @Post('donation-receipts')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async create(@Body() dto: CreateDonationReceiptDto, @Req() request: ReceiptCommandRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.receipts.create(dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Get('donation-receipts/:id')
  receipt(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.receipt(id, request);
  }

  @Post('donation-receipts/:id/counts')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async count(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: RecordReceiptCountDto,
    @Req() request: ReceiptCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.receipts.recordCount(id, dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('donation-receipts/:id/review')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async review(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: ReviewDonationReceiptDto,
    @Req() request: ReceiptCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.receipts.review(id, dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('donation-receipts/:id/post')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async post(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: PostDonationReceiptDto,
    @Req() request: ReceiptCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.receipts.post(id, dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('donation-receipts/:id/release-held')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async releaseHeld(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: ReleaseHeldDonationDto,
    @Req() request: ReceiptCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.receipts.releaseHeld(id, dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Get('donation-disputes')
  disputes(@Query() query: DonationDisputePageQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.disputes(query, request);
  }

  @Post('donation-disputes/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async resolveDispute(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: ResolveDonationDisputeDto,
    @Req() request: ReceiptCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.receipts.resolveDispute(id, dto, request);
    replay(response, result.replay);
    return result.value;
  }
}
