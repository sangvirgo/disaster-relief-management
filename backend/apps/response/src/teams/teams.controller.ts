import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { AddTeamMemberDto, CreateTeamDto, SetTeamPositionDto, TeamPageQueryDto, TransferTeamLeaderDto, UpdateTeamDto } from './teams.dto';
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

  @Post('teams/:id/members')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async addMember(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: AddTeamMemberDto,
    @Req() request: TeamRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.teams.addMember(id, dto, key(request), request);
    replayHeader(response, result.replay);
    return result.value;
  }

  @Post('teams/:id/members/:user_id/remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async removeMember(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Param('user_id', new ParseUUIDPipe({ version: 'all' })) userId: string,
    @Req() request: TeamRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    noStore(response);
    const result = await this.teams.removeMember(id, userId, key(request), request);
    replayHeader(response, result.replay);
  }

  @Post('teams/:id/leader')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async transferLeader(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: TransferTeamLeaderDto,
    @Req() request: TeamRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.teams.transferLeader(id, dto, key(request), request);
    replayHeader(response, result.replay);
    return result.value;
  }

  @Put('teams/:id/position')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setPosition(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: SetTeamPositionDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    noStore(response);
    await this.teams.setPosition(id, dto, request);
  }
}
