import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { AdjustNeedQuantityDto, CancelNeedDto, CreateNeedDto } from './needs.dto';
import { NeedCommandsService } from './need-commands.service';
import { NeedCommandRequest } from './needs.helpers';
import { NeedsService } from './needs.service';

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

@Controller()
export class NeedsController {
  constructor(private readonly needs: NeedsService, private readonly commands: NeedCommandsService) {}

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

  @Post('needs/:id/increase')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  increase(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: AdjustNeedQuantityDto,
    @Req() request: NeedCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.increase(id, dto, request));
  }

  @Post('needs/:id/reduce')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  reduce(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: AdjustNeedQuantityDto,
    @Req() request: NeedCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.reduce(id, dto, request));
  }

  @Post('needs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  cancel(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: CancelNeedDto,
    @Req() request: NeedCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.commandResult(response, this.commands.cancel(id, dto, request));
  }

  private async commandResult(
    response: Response,
    result: ReturnType<NeedCommandsService['increase']>,
  ): Promise<Record<string, unknown>> {
    const outcome = await result;
    if (outcome.replay) response.setHeader('Idempotent-Replay', 'true');
    return outcome.value;
  }
}
