import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, Res, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '@c48/technical/errors/errors';
import { IdempotencyKeyInterceptor } from '@c48/technical/idempotency/idempotency.interceptor';
import { EvidenceService } from './evidence.service';
import { noStore } from '@c48/technical/http/response-headers';

type EvidenceRequest = Request & { idempotencyKey?: string };

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Controller()
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Post('requests/:id/evidence')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async upload(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Req() request: EvidenceRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    if (!request.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
    const result = await this.evidence.upload(
      id, request.idempotencyKey, headerValue(request.headers['x-tracking-code']),
      headerValue(request.headers['x-tracking-secret']), request,
    );
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }

  @Post('missions/:id/evidence')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async uploadMission(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Req() request: EvidenceRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    if (!request.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
    const result = await this.evidence.uploadMission(id, request.idempotencyKey, request);
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }

  @Get('evidence/:id/download')
  async download(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.evidence.download(
      id, headerValue(request.headers['x-tracking-code']), headerValue(request.headers['x-tracking-secret']), request,
    );
  }
}
