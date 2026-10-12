import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { CreateNeedDto } from './needs.dto';
import { NeedCommandRequest, NeedsService } from './needs.service';

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

@Controller()
export class NeedsController {
  constructor(private readonly needs: NeedsService) {}

  @Post('needs')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async create(
    @Body() dto: CreateNeedDto,
    @Req() request: NeedCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    const result = await this.needs.create(dto, request);
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }
}
