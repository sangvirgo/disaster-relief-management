import { Module } from '@nestjs/common';
import { CircuitBreakerClient } from '@c48/technical/http/service-client';
import { loadLogisticsAuthConfig } from './logistics-auth';
import {
  LOGISTICS_IDENTITY_CLIENT,
  LOGISTICS_IDENTITY_CONFIG,
  LogisticsIdentityService,
  loadLogisticsIdentityConfig,
} from './logistics-identity.service';
import { LOGISTICS_AUTH_CONFIG, LogisticsSessionService } from './logistics-session.service';

@Module({
  providers: [
    { provide: LOGISTICS_AUTH_CONFIG, useFactory: () => loadLogisticsAuthConfig() },
    { provide: LOGISTICS_IDENTITY_CONFIG, useFactory: () => loadLogisticsIdentityConfig() },
    {
      provide: LOGISTICS_IDENTITY_CLIENT,
      inject: [LOGISTICS_IDENTITY_CONFIG],
      useFactory: (config: ReturnType<typeof loadLogisticsIdentityConfig>) =>
        new CircuitBreakerClient(config.identityBaseUrl, 'IDENTITY_UNAVAILABLE', { timeoutMs: config.timeoutMs, maxSockets: 30 }),
    },
    LogisticsIdentityService,
    LogisticsSessionService,
  ],
  exports: [LOGISTICS_AUTH_CONFIG, LogisticsSessionService, LogisticsIdentityService],
})
export class LogisticsAuthModule {}
