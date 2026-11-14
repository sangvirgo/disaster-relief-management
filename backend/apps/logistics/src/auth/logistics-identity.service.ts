import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { CircuitBreakerClient } from '@c48/technical/http/service-client';
import { AppError } from '@c48/technical/errors/errors';
import type { ServiceName } from '@c48/technical/security/service-token';
import { Grant, validGrant } from '@c48/identity-contracts/permissions';
import { ServiceTokenCache } from '@c48/technical/http/service-token-cache';
import type { LogisticsAccessTokenClaims } from './logistics-auth';

export const LOGISTICS_IDENTITY_CONFIG = Symbol('LOGISTICS_IDENTITY_CONFIG');
export const LOGISTICS_IDENTITY_CLIENT = Symbol('LOGISTICS_IDENTITY_CLIENT');

export interface LogisticsIdentityConfig {
  identityBaseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
}

export interface LogisticsSession {
  userId: string;
  grants: Grant[];
}

function unavailable(): AppError {
  return new AppError('IDENTITY_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
}

export function loadLogisticsIdentityConfig(env: Record<string, string | undefined> = process.env): LogisticsIdentityConfig {
  const identityBaseUrl = env.IDENTITY_BASE_URL ?? '';
  const clientId = env.LOGISTICS_SERVICE_CLIENT_ID ?? '';
  const clientSecret = env.LOGISTICS_SERVICE_CLIENT_SECRET ?? '';
  const timeoutMs = Number(env.INTROSPECT_TIMEOUT_MS ?? 500);
  try {
    const url = new URL(identityBaseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !clientId || clientId.length > 64 ||
        clientSecret.length < 32 || clientSecret.length > 256 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 2_000) {
      throw new Error('invalid');
    }
  } catch {
    throw new Error('Invalid Logistics configuration: IDENTITY_BASE_URL, LOGISTICS_SERVICE_CLIENT_ID, LOGISTICS_SERVICE_CLIENT_SECRET, INTROSPECT_TIMEOUT_MS');
  }
  return { identityBaseUrl, clientId, clientSecret, timeoutMs };
}

@Injectable()
export class LogisticsIdentityService implements OnModuleDestroy {
  private readonly serviceTokens: ServiceTokenCache;
  private readonly introspections = new Map<string, Promise<LogisticsSession>>();

  constructor(
    @Inject(LOGISTICS_IDENTITY_CLIENT) private readonly client: CircuitBreakerClient,
    @Inject(LOGISTICS_IDENTITY_CONFIG) config: LogisticsIdentityConfig,
  ) { this.serviceTokens = new ServiceTokenCache(client, config); }

  async introspect(claims: LogisticsAccessTokenClaims): Promise<LogisticsSession> {
    const key = `${claims.sid}:${claims.sub}`;
    const existing = this.introspections.get(key);
    if (existing) return existing;
    const operation = this.fetchIntrospection(claims);
    this.introspections.set(key, operation);
    void operation.finally(() => this.introspections.delete(key)).catch(() => undefined);
    return operation;
  }

  serviceToken(audience: ServiceName): Promise<string> {
    return this.serviceTokens.get(audience);
  }

  onModuleDestroy(): void {
    this.client.close();
  }

  private async fetchIntrospection(claims: LogisticsAccessTokenClaims): Promise<LogisticsSession> {
    const token = await this.serviceTokens.get('identity');
    let result;
    try {
      result = await this.client.post<unknown>('/api/v1/identity/internal/introspect', { sid: claims.sid, sub: claims.sub }, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailable();
    }
    if (result.status !== 200 || !result.body || typeof result.body !== 'object') throw unavailable();
    const value = result.body as Record<string, unknown>;
    if (value.active === false && value.user_id === claims.sub) throw new AppError('SESSION_EXPIRED', { status: 401 });
    if (value.active !== true || value.user_id !== claims.sub || !Array.isArray(value.grants) || !value.grants.every(validGrant)) throw unavailable();
    return { userId: claims.sub, grants: value.grants as Grant[] };
  }

}
