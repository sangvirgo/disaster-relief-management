import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { CreateTeamDto, TeamPageQueryDto, UpdateTeamDto } from './teams.dto';
import { TeamsService } from './teams.service';

type TeamRequest = Request & { idempotencyKey?: string };

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

function key(request: TeamRequest): string {
  if (!request.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
  return request.idempotencyKey;
}

function replayHeader(response: Response, replay: boolean): void {
  if (replay) response.setHeader('Idempotent-Replay', 'true');
}

@Controller()
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get('skills')
  async skills(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.teams.skills(request);
  }

  @Post('teams')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async create(@Body() dto: CreateTeamDto, @Req() request: TeamRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.teams.create(dto, key(request), request);
    replayHeader(response, result.replay);
    return result.value;
  }

  @Get('teams')
  async list(@Query() query: TeamPageQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.teams.list(query, request);
  }

  @Get('teams/:id')
  async detail(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.teams.detail(id, request);
  }

  @Patch('teams/:id')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async update(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: UpdateTeamDto,
    @Req() request: TeamRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.teams.update(id, dto, key(request), request);
    replayHeader(response, result.replay);
    return result.value;
  }
}
