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

export interface ResponseCampaignCenter {
  lat: number;
  lng: number;
}

export interface ResponseCampaign {
  id: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'CLOSED';
  version: number;
  /** Campaign area, present when Response publishes it. Both fields are null when the campaign has no area yet. */
  center?: ResponseCampaignCenter | null;
  radius_m?: number | null;
}

const maxCampaignRadiusM = 300_000;

function parseArea(value: Record<string, unknown>): Pick<ResponseCampaign, 'center' | 'radius_m'> {
  const hasCenter = Object.hasOwn(value, 'center');
  const hasRadius = Object.hasOwn(value, 'radius_m');
  if (!hasCenter && !hasRadius) return {};
  const center = value.center;
  const radius = value.radius_m;
  if (!hasCenter || !hasRadius || (center === null) !== (radius === null)) throw unavailable();
  if (center === null) return { center: null, radius_m: null };
  const point = center as Record<string, unknown>;
  if (typeof point !== 'object' || !Number.isFinite(point.lat) || !Number.isFinite(point.lng) ||
      (point.lat as number) < -90 || (point.lat as number) > 90 || (point.lng as number) < -180 || (point.lng as number) > 180 ||
      !Number.isInteger(radius) || (radius as number) < 1 || (radius as number) > maxCampaignRadiusM) throw unavailable();
  return { center: { lat: point.lat as number, lng: point.lng as number }, radius_m: radius as number };
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
        !Number.isInteger(value.version)) throw unavailable();
    return {
      id: value.id as string,
      status: value.status as ResponseCampaign['status'],
      version: value.version as number,
      ...parseArea(value),
    };
  }

  onModuleDestroy(): void {
    this.client.close();
  }
}
