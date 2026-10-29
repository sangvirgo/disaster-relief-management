import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IdempotencyKeyInterceptor } from '@c48/technical/idempotency/idempotency.interceptor';
import {
  ClaimRequestDto, MineQueryDto, RecoverRequestDto, RecoveryIssueDto, RevokeTrackingSecretDto,
  RequestEventsQueryDto, SupplementRequestDto,
} from './tracking.dto';
import { TrackingService } from './tracking.service';
import { noStore, requireIdempotencyKey as idempotencyKey, markIdempotentReplay as replayHeader } from '@c48/technical/http/response-headers';

type TrackingRequest = Request & { idempotencyKey?: string };

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Controller('requests')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get('track')
  async track(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.tracking.track(
      headerValue(request.headers['x-tracking-code']),
      headerValue(request.headers['x-tracking-secret']),
      request,
    );
  }

  @Get('mine')
  async mine(@Query() query: MineQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.tracking.mine(query, request);
  }

  @Get(':id/events')
  async events(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Query() query: RequestEventsQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.tracking.events(id, headerValue(request.headers['x-tracking-code']), headerValue(request.headers['x-tracking-secret']), query, request);
  }

  @Post('claim')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async claim(
    @Body() dto: ClaimRequestDto,
    @Req() request: TrackingRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.tracking.claim(dto, idempotencyKey(request), headerValue(request.headers['x-tracking-secret']), request);
    replayHeader(response, result.replay);
    return result.value;
  }

  @Post('recover')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async recover(
    @Body() dto: RecoverRequestDto,
    @Req() request: TrackingRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.tracking.recover(dto, idempotencyKey(request), headerValue(request.headers['x-recovery-code']), request);
    replayHeader(response, result.replay);
    return result.value;
  }

  @Post(':id/supplements')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async supplement(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: SupplementRequestDto,
    @Req() request: TrackingRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.tracking.supplement(
      id, dto, idempotencyKey(request), headerValue(request.headers['x-tracking-code']),
      headerValue(request.headers['x-tracking-secret']), request,
    );
    replayHeader(response, result.replay);
    return result.value;
  }

  @Put(':id/report')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async updateReport(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: SupplementRequestDto,
    @Req() request: TrackingRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.tracking.supplement(
      id, dto, idempotencyKey(request), headerValue(request.headers['x-tracking-code']),
      headerValue(request.headers['x-tracking-secret']), request, 'PUT',
    );
    replayHeader(response, result.replay);
    return result.value;
  }

  @Post(':id/tracking-secret/revoke')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async revokeSecret(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: RevokeTrackingSecretDto,
    @Req() request: TrackingRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.tracking.revokeSecret(id, dto, idempotencyKey(request), request);
    replayHeader(response, result.replay);
    return result.value;
  }

  @Post(':id/recovery')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async issueRecovery(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: RecoveryIssueDto,
    @Req() request: TrackingRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.tracking.issueRecovery(id, dto, idempotencyKey(request), request);
    replayHeader(response, result.replay);
    return result.value;
  }
}
