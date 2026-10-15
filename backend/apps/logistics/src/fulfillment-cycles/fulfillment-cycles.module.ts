import { Module } from '@nestjs/common';
import { CircuitBreakerClient } from '../../../../packages/technical/src/http/service-client';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { LogisticsServiceTokenGuard } from '../auth/logistics-service-token.guard';
import { ResponseCycleIntentClient, RESPONSE_CYCLE_INTENT_CLIENT } from '../integrations/response/response-cycle-intent.client';
import { FulfillmentCyclesController } from './fulfillment-cycles.controller';
import { FulfillmentCyclesService } from './fulfillment-cycles.service';

interface ResponseCycleIntentConfig {
  baseUrl: string;
  timeoutMs: number;
}

const RESPONSE_CYCLE_INTENT_CONFIG = Symbol('RESPONSE_CYCLE_INTENT_CONFIG');

function loadResponseCycleIntentConfig(env: Record<string, string | undefined> = process.env): ResponseCycleIntentConfig {
  const baseUrl = env.RESPONSE_BASE_URL ?? '';
  const timeoutMs = Number(env.INTROSPECT_TIMEOUT_MS ?? 2_000);
  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 2_000) {
      throw new Error('invalid');
    }
  } catch {
    throw new Error('Invalid Logistics configuration: RESPONSE_BASE_URL, INTROSPECT_TIMEOUT_MS');
  }
  return { baseUrl, timeoutMs };
}

@Module({
  imports: [LogisticsAuthModule],
  controllers: [FulfillmentCyclesController],
  providers: [
    {
      provide: RESPONSE_CYCLE_INTENT_CONFIG,
      useFactory: () => loadResponseCycleIntentConfig(),
    },
    {
      provide: RESPONSE_CYCLE_INTENT_CLIENT,
      inject: [RESPONSE_CYCLE_INTENT_CONFIG],
      useFactory: (config: ResponseCycleIntentConfig) => new CircuitBreakerClient(
        config.baseUrl,
        'RESPONSE_UNAVAILABLE',
        { timeoutMs: config.timeoutMs, maxSockets: 50 },
      ),
    },
    ResponseCycleIntentClient,
    FulfillmentCyclesService,
    LogisticsServiceTokenGuard,
  ],
})
export class FulfillmentCyclesModule {}
