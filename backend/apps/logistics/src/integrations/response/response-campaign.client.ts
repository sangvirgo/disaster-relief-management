import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { CircuitBreakerClient } from '@c48/technical/http/service-client';
import { AppError } from '@c48/technical/errors/errors';
import { LogisticsIdentityService } from '../../auth/logistics-identity.service';

export const LOGISTICS_RESPONSE_CLIENT = Symbol('LOGISTICS_RESPONSE_CLIENT');
export const RESPONSE_CAMPAIGN_CONFIG = Symbol('RESPONSE_CAMPAIGN_CONFIG');

export interface ResponseCampaignConfig {
  baseUrl: string;
  timeoutMs: number;
}

export interface ResponseCampaign {
  id: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED';
  organization_id: string;
  region_code: string | null;
  version: number;
}

export function loadResponseCampaignConfig(env: Record<string, string | undefined> = process.env): ResponseCampaignConfig {
  const baseUrl = env.RESPONSE_BASE_URL ?? '';
  const timeoutMs = Number(env.INTROSPECT_TIMEOUT_MS ?? 500);
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

function unavailable(): AppError {
  return new AppError('RESPONSE_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
}

@Injectable()
export class LogisticsResponseCampaignClient implements OnModuleDestroy {
  constructor(
    @Inject(LOGISTICS_RESPONSE_CLIENT) private readonly client: CircuitBreakerClient,
    private readonly identity: LogisticsIdentityService,
  ) {}

  async getCampaign(id: string): Promise<ResponseCampaign> {
    let result;
    try {
      const token = await this.identity.serviceToken('response');
      result = await this.client.get<unknown>(`/api/v1/response/internal/campaigns/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'RESPONSE_UNAVAILABLE') throw error;
      throw unavailable();
    }
    if (result.status === 404) throw new AppError('CAMPAIGN_NOT_ACTIVE', { status: 409 });
    if (result.status !== 200 || !result.body || typeof result.body !== 'object') throw unavailable();
    const value = result.body as Record<string, unknown>;
    if (value.id !== id || !['DRAFT', 'ACTIVE', 'PAUSED', 'CLOSED'].includes(String(value.status)) ||
        typeof value.organization_id !== 'string' ||
        !(value.region_code === null || typeof value.region_code === 'string') ||
        !Number.isInteger(value.version)) throw unavailable();
    return value as unknown as ResponseCampaign;
  }

  onModuleDestroy(): void {
    this.client.close();
  }
}
