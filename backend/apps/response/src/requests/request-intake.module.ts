import { CircuitBreakerClient } from '../../../../packages/technical/src/http/service-client';
import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../../../packages/technical/src/idempotency/idempotency';
import { loadReporterSessionConfig, REPORTER_SESSION_CONFIG, REPORTER_SESSION_CLIENT, ReporterSessionConfig, ReporterSessionService } from './reporter-session';
import { RequestIntakeController } from './request-intake.controller';
import { loadRequestIntakeConfig, REQUEST_INTAKE_CONFIG, RequestIntakeService } from './request-intake.service';

@Module({
  controllers: [RequestIntakeController],
  providers: [
    { provide: REQUEST_INTAKE_CONFIG, useFactory: () => loadRequestIntakeConfig() },
    { provide: REPORTER_SESSION_CONFIG, useFactory: () => loadReporterSessionConfig() },
    {
      provide: REPORTER_SESSION_CLIENT,
      inject: [REPORTER_SESSION_CONFIG],
      useFactory: (config: ReporterSessionConfig) => new CircuitBreakerClient(config.identityBaseUrl, 'IDENTITY_UNAVAILABLE', { timeoutMs: config.timeoutMs, maxSockets: 30 }),
    },
    IdempotencyService,
    ReporterSessionService,
    RequestIntakeService,
  ],
  exports: [REQUEST_INTAKE_CONFIG, IdempotencyService, ReporterSessionService],
})
export class RequestIntakeModule {}
