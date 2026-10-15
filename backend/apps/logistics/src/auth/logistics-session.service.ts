import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { LogisticsIdentityService, LogisticsSession } from './logistics-identity.service';
import { accessCredential, LogisticsAuthConfig } from './logistics-auth';

export const LOGISTICS_AUTH_CONFIG = Symbol('LOGISTICS_AUTH_CONFIG');

export interface AuthenticatedLogisticsSession extends LogisticsSession {
  identityHeaders: Record<string, string>;
}

@Injectable()
export class LogisticsSessionService {
  constructor(
    @Inject(LOGISTICS_AUTH_CONFIG) private readonly config: LogisticsAuthConfig,
    private readonly identity: LogisticsIdentityService,
  ) {}

  async require(request: Request): Promise<AuthenticatedLogisticsSession> {
    const { claims, identityHeaders } = accessCredential(request, this.config);
    const session = await this.identity.introspect(claims);
    return { ...session, identityHeaders };
  }
}
