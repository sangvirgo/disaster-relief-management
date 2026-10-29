import { Module } from '@nestjs/common';
import { CircuitBreakerClient } from '@c48/technical/http/service-client';
import { IdempotencyService } from '@c48/technical/idempotency/idempotency';
import { IdempotencyKeyInterceptor } from '@c48/technical/idempotency/idempotency.interceptor';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { LogisticsServiceTokenGuard } from '../auth/logistics-service-token.guard';
import { ResponseCampaignModule } from '../integrations/response/response-campaign.module';
import { NeedsController } from './needs.controller';
import { NeedCommitmentsService } from './need-commitments.service';
import { NeedCommandsService } from './need-commands.service';
import { NeedsQueriesService } from './needs-queries.service';
import { NeedsService } from './needs.service';
import {
  loadResponseAdmissionConfig, ResponseAdmissionClient, RESPONSE_ADMISSION_CLIENT,
  RESPONSE_ADMISSION_CONFIG,
} from './response-admission.client';

@Module({
  imports: [LogisticsAuthModule, ResponseCampaignModule],
  controllers: [NeedsController],
  providers: [
    NeedsService,
    NeedCommandsService,
    NeedCommitmentsService,
    NeedsQueriesService,
    LogisticsServiceTokenGuard,
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
