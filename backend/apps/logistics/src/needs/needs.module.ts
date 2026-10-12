import { Module } from '@nestjs/common';
import { CircuitBreakerClient } from '../../../../packages/technical/src/http/service-client';
import { IdempotencyService } from '../../../../packages/technical/src/idempotency/idempotency';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { NeedsController } from './needs.controller';
import { NeedsService } from './needs.service';
import {
  loadResponseAdmissionConfig, ResponseAdmissionClient, RESPONSE_ADMISSION_CLIENT,
  RESPONSE_ADMISSION_CONFIG,
} from './response-admission.client';

@Module({
  imports: [LogisticsAuthModule],
  controllers: [NeedsController],
  providers: [
    NeedsService,
    IdempotencyService,
    IdempotencyKeyInterceptor,
    ResponseAdmissionClient,
    { provide: RESPONSE_ADMISSION_CONFIG, useFactory: () => loadResponseAdmissionConfig() },
    {
      provide: RESPONSE_ADMISSION_CLIENT,
      inject: [RESPONSE_ADMISSION_CONFIG],
      useFactory: (config: ReturnType<typeof loadResponseAdmissionConfig>) =>
        new CircuitBreakerClient(config.baseUrl, 'RESPONSE_UNAVAILABLE', { timeoutMs: config.timeoutMs, maxSockets: 10 }),
    },
  ],
})
export class NeedsModule {}
