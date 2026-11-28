import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res,
  UseGuards, UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IdempotencyKeyInterceptor } from '@c48/technical/idempotency/idempotency.interceptor';
import { CampaignHistoryQueryDto, CampaignActionDto, CampaignAreaDto, CampaignCreateDto, CommonQueueQueryDto, CampaignPageQueryDto, CampaignPatchDto, CampaignReasonActionDto } from './campaigns.dto';
import { CampaignCommandRequest, CampaignsService } from './campaigns.service';
import { CampaignCoordinationService } from './campaign-coordination.service';
import { ResponseServiceTokenGuard } from './service-token.guard';
import { LogisticsCampaignWarehouseNotifier } from '../integrations/logistics/logistics-campaign-warehouse.client';
import { noStore, requireIdempotencyKey as key } from '@c48/technical/http/response-headers';

function replay(response: Response, result: { replay: boolean }): void {
  if (result.replay) response.setHeader('Idempotent-Replay', 'true');
}

@Controller()
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly coordination: CampaignCoordinationService,
    private readonly warehouses: LogisticsCampaignWarehouseNotifier,
  ) {}

  @Get('campaigns/triage')
  async triage(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.coordination.triage(request);
  }

  @Get('campaigns/overview')
  async overview(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.coordination.overview(request);
  }

  @Get('me/engagements')
  async myEngagements(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.coordination.myEngagements(request);
  }

  @Get('me/coordination-history')
  async myHistory(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.coordination.myHistory(request);
  }

  @Post('campaigns/:id/engage')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async engage(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Req() request: CampaignCommandRequest,
    @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.coordination.engage(id, key(request), request);
    replay(response, result);
    return result.value;
  }

  @Post('campaigns/:id/disengage')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async disengage(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Req() request: CampaignCommandRequest,
    @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.coordination.disengage(id, key(request), request);
    replay(response, result);
    return result.value;
  }

  @Get('campaigns/:id/history/summary')
  async historySummary(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Req() request: Request,
    @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.coordination.historySummary(id, request);
  }

  @Get('campaigns/:id/history')
  async history(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Query() query: CampaignHistoryQueryDto,
    @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.coordination.history(id, query.cursor, query.limit, request, query);
  }

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
    if (!result.replay && (dto.center !== undefined || dto.radius_m !== undefined)) this.warehouses.campaignChanged(id);
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

  @Post('campaigns/:id/area')
  @UseInterceptors(IdempotencyKeyInterceptor)
  async changeArea(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: CampaignAreaDto,
    @Req() request: CampaignCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.campaigns.changeArea(id, dto, key(request), request);
    replay(response, result);
    if (!result.replay) this.warehouses.campaignChanged(id);
    return result.value;
  }

  @Get('campaigns/common-queue/suggestions')
  async commonQueueSuggestions(@Query() query: CommonQueueQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.coordination.commonQueueSuggestions(query, request);
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
    // A campaign that starts or resumes work needs its primary warehouse now, not on the next sweep.
    if (!result.replay && (action === 'activate' || action === 'resume')) this.warehouses.campaignChanged(id);
    return result.value;
  }
}
