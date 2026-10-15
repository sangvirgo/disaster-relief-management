import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { verifyServiceToken } from '../../../../packages/technical/src/security/service-token';
import type { ServiceName } from '../../../../packages/technical/src/security/service-token';
import { REQUEST_INTAKE_CONFIG } from '../requests/request-intake.service';
import type { RequestIntakeConfig } from '../requests/request-intake.service';

@Injectable()
export class LogisticsServiceTokenGuard implements CanActivate {
  constructor(@Inject(REQUEST_INTAKE_CONFIG) private readonly config: Pick<RequestIntakeConfig, 'auth'>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { serviceCaller?: ServiceName }>();
    const header = request.headers.authorization;
    const authorization = Array.isArray(header) ? header[0] : header;
    const token = authorization?.match(/^Bearer ([A-Za-z0-9_.-]+)$/iu)?.[1];
    if (!token) throw new AppError('UNAUTHENTICATED', { status: 401 });
    request.serviceCaller = verifyServiceToken(token, this.config.auth, 'response', ['logistics']).sub;
    return true;
  }
}
