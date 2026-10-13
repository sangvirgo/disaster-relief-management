import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { LogisticsServiceTokenGuard } from './logistics-service-token.guard';
import { ReopenRequestDto, RequestVersionDto, RequestVersionReasonDto, ResolveRequestDto } from './request-resolution.dto';
import { RequestResolutionLifecycleService } from './request-resolution-lifecycle.service';
import { RequestResolutionStateService } from './request-resolution-state.service';
import { RequestResolutionService } from './request-resolution.service';

type OperationRequest = Request & { idempotencyKey?: string };

function idempotencyKey(request: OperationRequest): string {
  if (!request.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
  return request.idempotencyKey;
}

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

@Controller()
export class RequestResolutionController {
  constructor(
    private readonly resolutions: RequestResolutionService,
    private readonly lifecycle: RequestResolutionLifecycleService,
    private readonly state: RequestResolutionStateService,
  ) {}

  @Post('requests/:requestId/resolve')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async resolve(
    @Param('requestId', new ParseUUIDPipe({ version: 'all' })) requestId: string,
    @Body() dto: ResolveRequestDto,
    @Req() request: OperationRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.resolutions.resolve(requestId, dto, idempotencyKey(request), request);
    return idempotentResponse(result, response);
  }

  @Post('requests/:requestId/cancel')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async cancel(
    @Param('requestId', new ParseUUIDPipe({ version: 'all' })) requestId: string,
    @Body() dto: RequestVersionReasonDto,
    @Req() request: OperationRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return idempotentResponse(await this.lifecycle.cancel(requestId, dto, idempotencyKey(request), request), response);
  }

  @Post('requests/:requestId/resolve/abort')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async abortResolution(
    @Param('requestId', new ParseUUIDPipe({ version: 'all' })) requestId: string,
    @Body() dto: RequestVersionReasonDto,
    @Req() request: OperationRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return idempotentResponse(await this.lifecycle.abortForRequest(requestId, dto, idempotencyKey(request), request), response);
  }

  @Post('requests/:requestId/close')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async close(
    @Param('requestId', new ParseUUIDPipe({ version: 'all' })) requestId: string,
    @Body() dto: RequestVersionDto,
    @Req() request: OperationRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return idempotentResponse(await this.state.close(requestId, dto, idempotencyKey(request), request), response);
  }

  @Post('requests/:requestId/reopen')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async reopen(
    @Param('requestId', new ParseUUIDPipe({ version: 'all' })) requestId: string,
    @Body() dto: ReopenRequestDto,
    @Req() request: OperationRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return idempotentResponse(await this.state.reopen(requestId, dto, idempotencyKey(request), request), response);
  }

  @Post('operations/:operationId/abort')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async abortOperation(
    @Param('operationId', new ParseUUIDPipe({ version: 'all' })) operationId: string,
    @Body() dto: RequestVersionReasonDto,
    @Req() request: OperationRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return idempotentResponse(await this.lifecycle.abortOperation(operationId, dto, idempotencyKey(request), request), response);
  }

  @Post('operations/:operationId/adopt')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async adoptOperation(
    @Param('operationId', new ParseUUIDPipe({ version: 'all' })) operationId: string,
    @Body() dto: RequestVersionReasonDto,
    @Req() request: OperationRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return idempotentResponse(await this.lifecycle.adopt(operationId, dto, idempotencyKey(request), request), response);
  }

  @Get('operations/:operationId')
  async operation(
    @Param('operationId', new ParseUUIDPipe({ version: 'all' })) operationId: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.resolutions.operation(operationId, request);
  }

  @Get('internal/operations/:intentId')
  @UseGuards(LogisticsServiceTokenGuard)
  async internalOperation(
    @Param('intentId', new ParseUUIDPipe({ version: 'all' })) intentId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.resolutions.internalOperation(intentId);
  }
}

function idempotentResponse(
  result: { status: number; value: Record<string, unknown>; replay: boolean }, response: Response,
): Record<string, unknown> {
  if (result.replay) response.setHeader('Idempotent-Replay', 'true');
  response.status(result.status);
  return result.value;
}
