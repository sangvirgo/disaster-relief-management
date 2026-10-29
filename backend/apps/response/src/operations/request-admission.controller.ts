import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '@c48/technical/errors/errors';
import { ResponseServiceTokenGuard } from '../campaigns/service-token.guard';
import { RequestAdmissionService } from './request-admission.service';
import { noStore } from '@c48/technical/http/response-headers';

type InternalRequest = Request & { serviceCaller?: string };

function actorRequest(request: InternalRequest): Request {
  const value = request.headers['x-actor-authorization'];
  const authorization = Array.isArray(value) ? value[0] : value;
  if (!authorization || !/^Bearer [A-Za-z0-9_.-]+$/u.test(authorization)) {
    throw new AppError('UNAUTHENTICATED', { status: 401 });
  }
  return { ...request, method: 'GET', headers: { authorization } } as Request;
}

function parseWorkCycle(value: string): number {
  if (!/^[1-9]\d*$/u.test(value)) throw new AppError('VALIDATION_FAILED', { status: 400 });
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new AppError('VALIDATION_FAILED', { status: 400 });
  return parsed;
}

@Controller('internal')
export class RequestAdmissionController {
  constructor(private readonly admission: RequestAdmissionService) {}

  @Post('requests/:id/cycles/:work_cycle/admit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ResponseServiceTokenGuard)
  async admit(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) requestId: string,
    @Param('work_cycle') workCyclePath: string,
    @Req() request: InternalRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    if (request.serviceCaller !== 'logistics') throw new AppError('FORBIDDEN', { status: 403 });
    return this.admission.admit(requestId, parseWorkCycle(workCyclePath), actorRequest(request));
  }
}
