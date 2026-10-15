import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { AppError } from '../../../../../packages/technical/src/errors/errors';
import { CircuitBreakerClient } from '../../../../../packages/technical/src/http/service-client';
import { LogisticsIdentityService } from '../../auth/logistics-identity.service';

export const RESPONSE_CYCLE_INTENT_CLIENT = Symbol('RESPONSE_CYCLE_INTENT_CLIENT');

export type ResolutionOutcomeBasis = 'RESCUE_COMPLETED' | 'SUPPLY_ONLY' | 'NO_ACTION_REQUIRED';

export interface ResponseCycleIntent {
  id: string;
  kind: 'RESOLUTION' | 'CANCELLATION';
  state: string;
  request_id: string;
  work_cycle: number;
  request_status: string;
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
  outcome_basis: ResolutionOutcomeBasis | null;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const outcomeBases = new Set<ResolutionOutcomeBasis>(['RESCUE_COMPLETED', 'SUPPLY_ONLY', 'NO_ACTION_REQUIRED']);
const upstreamErrors: Record<string, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  STATE_TRANSITION_INVALID: 409,
};

function unavailable(): AppError {
  return new AppError('RESPONSE_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
}

function upstreamError(status: number, body: unknown): AppError {
  if (body && typeof body === 'object') {
    const code = (body as Record<string, unknown>).code;
    if (typeof code === 'string' && upstreamErrors[code] === status) return new AppError(code, { status });
  }
  return unavailable();
}

@Injectable()
export class ResponseCycleIntentClient implements OnModuleDestroy {
  constructor(
    @Inject(RESPONSE_CYCLE_INTENT_CLIENT) private readonly client: CircuitBreakerClient,
    private readonly identity: LogisticsIdentityService,
  ) {}

  async getIntent(intentId: string): Promise<ResponseCycleIntent> {
    if (!uuidPattern.test(intentId)) throw new AppError('VALIDATION_FAILED', { status: 400 });
    let serviceToken: string;
    try {
      serviceToken = await this.identity.serviceToken('response');
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailable();
    }

    let result;
    try {
      result = await this.client.request<unknown>(
        `/api/v1/response/internal/operations/${encodeURIComponent(intentId)}`,
        { method: 'GET', headers: { authorization: `Bearer ${serviceToken}` } },
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailable();
    }
    if (result.status !== 200) throw upstreamError(result.status, result.body);
    return this.intentValue(result.body, intentId);
  }

  onModuleDestroy(): void {
    this.client.close();
  }

  private intentValue(value: unknown, expectedId: string): ResponseCycleIntent {
    if (!value || typeof value !== 'object') throw unavailable();
    const row = value as Record<string, unknown>;
    if (row.id !== expectedId || typeof row.kind !== 'string' || !['RESOLUTION', 'CANCELLATION'].includes(row.kind) ||
        typeof row.state !== 'string' || typeof row.request_id !== 'string' || !uuidPattern.test(row.request_id) ||
        typeof row.work_cycle !== 'number' || !Number.isSafeInteger(row.work_cycle) || row.work_cycle < 1 ||
        typeof row.request_status !== 'string' || typeof row.organization_id !== 'string' || !uuidPattern.test(row.organization_id) ||
        !(row.region_code === null || typeof row.region_code === 'string') ||
        !(row.campaign_id === null || (typeof row.campaign_id === 'string' && uuidPattern.test(row.campaign_id))) ||
        !(row.outcome_basis === null || (typeof row.outcome_basis === 'string' && outcomeBases.has(row.outcome_basis as ResolutionOutcomeBasis)))) {
      throw unavailable();
    }
    return row as unknown as ResponseCycleIntent;
  }
}
