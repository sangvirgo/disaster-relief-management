import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { CreateDriveDto, DrivePageQueryDto, DriveReasonActionDto, DriveVersionActionDto, PatchDriveDto } from './drives.dto';
import { DriveCommandRequest, DrivesService } from './drives.service';
import { DriveQueriesService } from './drives-queries.service';

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

function replay(response: Response, isReplay: boolean): void {
  if (isReplay) response.setHeader('Idempotent-Replay', 'true');
}

@Controller()
export class DrivesController {
  constructor(
    private readonly drives: DrivesService,
    private readonly queries: DriveQueriesService,
  ) {}

  @Get('public/donation-drives')
  publicList(@Query() query: DrivePageQueryDto, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.publicList(query);
  }

  @Get('public/donation-drives/:id')
  publicDetail(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.publicDetail(id);
  }

  @Get('donation-drives')
  list(@Query() query: DrivePageQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.list(query, request);
  }

  @Post('donation-drives')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async create(@Body() dto: CreateDriveDto, @Req() request: DriveCommandRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.drives.create(dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Patch('donation-drives/:id')
  @UseInterceptors(IdempotencyKeyInterceptor)
  async patch(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: PatchDriveDto,
    @Req() request: DriveCommandRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.drives.patch(id, dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('donation-drives/:id/open')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  open(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: DriveVersionActionDto,
    @Req() request: DriveCommandRequest, @Res({ passthrough: true }) response: Response) {
    return this.transition(id, 'open', dto, request, response);
  }

  @Post('donation-drives/:id/pause')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  pause(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: DriveReasonActionDto,
    @Req() request: DriveCommandRequest, @Res({ passthrough: true }) response: Response) {
    return this.transition(id, 'pause', dto, request, response);
  }

  @Post('donation-drives/:id/resume')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  resume(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: DriveVersionActionDto,
    @Req() request: DriveCommandRequest, @Res({ passthrough: true }) response: Response) {
    return this.transition(id, 'resume', dto, request, response);
  }

  @Post('donation-drives/:id/close')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  close(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: DriveReasonActionDto,
    @Req() request: DriveCommandRequest, @Res({ passthrough: true }) response: Response) {
    return this.transition(id, 'close', dto, request, response);
  }

  private async transition(
    id: string,
    action: 'open' | 'pause' | 'resume' | 'close',
    dto: DriveVersionActionDto | DriveReasonActionDto,
    request: DriveCommandRequest,
    response: Response,
  ) {
    noStore(response);
    const result = await this.drives.transition(id, action, dto, request);
    replay(response, result.replay);
    return result.value;
  }
}
