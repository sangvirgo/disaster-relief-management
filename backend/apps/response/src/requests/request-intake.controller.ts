import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { CreateProxyRequestDto, CreateSelfRequestDto } from './request-intake.dto';
import { REQUEST_INTAKE_CONFIG, RequestIntakeConfig, RequestIntakeService } from './request-intake.service';
import { ReporterSessionService } from './reporter-session';
import { reporterUserId } from './reporter-token';

type IntakeRequest = Request & { idempotencyKey?: string };

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

@Controller('requests')
export class RequestIntakeController {
  constructor(
    private readonly intake: RequestIntakeService,
    private readonly sessions: ReporterSessionService,
    @Inject(REQUEST_INTAKE_CONFIG) private readonly config: RequestIntakeConfig,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async create(
    @Body() dto: CreateSelfRequestDto,
    @Req() request: IntakeRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
    response.setHeader('Cache-Control', 'no-store');
    const result = await this.intake.createSelf(
      dto,
      request.idempotencyKey,
      reporterUserId(request, this.config.auth),
      headerValue(request.headers['x-tracking-secret']),
      request.ip || request.socket.remoteAddress || 'unknown',
    );
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }

  @Post('proxy')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async createProxy(
    @Body() dto: CreateProxyRequestDto,
    @Req() request: IntakeRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!request.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
    response.setHeader('Cache-Control', 'no-store');
    const session = await this.sessions.require(request);
    const result = await this.intake.createProxy(
      dto,
      request.idempotencyKey,
      session.userId,
      request.ip || request.socket.remoteAddress || 'unknown',
    );
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }
}
