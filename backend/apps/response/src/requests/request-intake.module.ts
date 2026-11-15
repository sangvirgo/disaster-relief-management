import { CircuitBreakerClient } from '@c48/technical/http/service-client';
import { Module } from '@nestjs/common';
import { IdempotencyService } from '@c48/technical/idempotency/idempotency';
import { loadReporterSessionConfig, REPORTER_SESSION_CONFIG, REPORTER_SESSION_CLIENT, ReporterSessionConfig, ReporterSessionService } from './reporter-session';
import { RequestIntakeController } from './request-intake.controller';
import { loadRequestIntakeConfig, REQUEST_INTAKE_CONFIG, RequestIntakeService } from './request-intake.service';
import { CAMPAIGN_CONFLICT_NOTIFIER } from './campaign-conflict-notifier.token';

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
    { provide: CAMPAIGN_CONFLICT_NOTIFIER, useExisting: ReporterSessionService },
    RequestIntakeService,
  ],
  exports: [REQUEST_INTAKE_CONFIG, IdempotencyService, ReporterSessionService],
})
export class RequestIntakeModule {}
