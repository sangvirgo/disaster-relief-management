import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, Res, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { EvidenceService } from './evidence.service';

type EvidenceRequest = Request & { idempotencyKey?: string };

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
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
