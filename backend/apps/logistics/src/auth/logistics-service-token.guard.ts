import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '@c48/technical/errors/errors';
import { verifyServiceToken } from '@c48/technical/security/service-token';
import type { ServiceName } from '@c48/technical/security/service-token';
import { LOGISTICS_AUTH_CONFIG } from './logistics-session.service';
import type { LogisticsAuthConfig } from './logistics-auth';

type ServiceRequest = Request & { serviceCaller?: ServiceName };

@Injectable()
export class LogisticsServiceTokenGuard implements CanActivate {
  constructor(
    @Inject(LOGISTICS_AUTH_CONFIG) private readonly config: Pick<LogisticsAuthConfig, 'issuer' | 'publicKey'>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ServiceRequest>();
    const header = request.headers.authorization;
    const authorization = Array.isArray(header) ? header[0] : header;
    const token = authorization?.match(/^Bearer ([A-Za-z0-9_.-]+)$/iu)?.[1];
    if (!token) throw new AppError('UNAUTHENTICATED', { status: 401 });
    request.serviceCaller = verifyServiceToken(token, this.config, 'logistics', ['response']).sub;
    return true;
  }
}
