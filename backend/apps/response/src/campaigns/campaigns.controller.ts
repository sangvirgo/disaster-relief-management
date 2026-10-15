import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res,
  UseGuards, UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { CampaignActionDto, CampaignCreateDto, CampaignPageQueryDto, CampaignPatchDto, CampaignReasonActionDto } from './campaigns.dto';
import { CampaignCommandRequest, CampaignsService } from './campaigns.service';
import { ResponseServiceTokenGuard } from './service-token.guard';

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

function key(request: CampaignCommandRequest): string {
  if (!request.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
  return request.idempotencyKey;
}

function replay(response: Response, result: { replay: boolean }): void {
  if (result.replay) response.setHeader('Idempotent-Replay', 'true');
}

@Controller()
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get('campaigns')
  async list(@Query() query: CampaignPageQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.campaigns.list(query, request);
  }

  @Post('campaigns')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async create(@Body() dto: CampaignCreateDto, @Req() request: CampaignCommandRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.campaigns.create(dto, key(request), request);
    replay(response, result);
    return result.value;
  }

  @Get('campaigns/:id')
  async detail(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.campaigns.detail(id, request);
  }

  @Patch('campaigns/:id')
  @UseInterceptors(IdempotencyKeyInterceptor)
  async patch(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: CampaignPatchDto,
    @Req() request: CampaignCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.campaigns.patch(id, dto, key(request), request);
    replay(response, result);
    return result.value;
  }

  @Post('campaigns/:id/activate')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async activate(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: CampaignActionDto,
    @Req() request: CampaignCommandRequest, @Res({ passthrough: true }) response: Response) {
    return this.transition(id, 'activate', dto, request, response);
  }

  @Post('campaigns/:id/pause')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async pause(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: CampaignReasonActionDto,
    @Req() request: CampaignCommandRequest, @Res({ passthrough: true }) response: Response) {
    return this.transition(id, 'pause', dto, request, response);
  }

  @Post('campaigns/:id/resume')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async resume(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: CampaignActionDto,
    @Req() request: CampaignCommandRequest, @Res({ passthrough: true }) response: Response) {
    return this.transition(id, 'resume', dto, request, response);
  }

  @Post('campaigns/:id/close')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async close(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: CampaignReasonActionDto,
    @Req() request: CampaignCommandRequest, @Res({ passthrough: true }) response: Response) {
    return this.transition(id, 'close', dto, request, response);
  }

  @Get('public/campaigns')
  async publicList(@Query() query: CampaignPageQueryDto, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.campaigns.publicList(query);
  }

  @Get('internal/campaigns/:id')
  @UseGuards(ResponseServiceTokenGuard)
  async internal(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.campaigns.internal(id);
  }

  private async transition(
    id: string,
    action: 'activate' | 'pause' | 'resume' | 'close',
    dto: CampaignActionDto | CampaignReasonActionDto,
    request: CampaignCommandRequest,
    response: Response,
  ) {
    noStore(response);
    const result = await this.campaigns.transition(id, action, dto, key(request), request);
    replay(response, result);
    return result.value;
  }
}
