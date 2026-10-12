import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { CircuitBreakerClient } from '../../../../packages/technical/src/http/service-client';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import type { Grant } from '../../../../packages/technical/src/security/permissions';
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

interface ServiceTokenResponse {
  access_token: string;
  expires_in: number;
}

const roles = new Set(['CITIZEN', 'VOLUNTEER', 'COORDINATOR', 'CAMPAIGN_MANAGER', 'OPERATIONS_MANAGER', 'INTAKE_STAFF', 'REVIEWER', 'DISTRIBUTION_STAFF', 'ADMIN']);
const scopes = new Set(['SYSTEM', 'ORGANIZATION', 'REGION', 'CAMPAIGN']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function unavailable(): AppError {
  return new AppError('IDENTITY_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
}

function validGrant(value: unknown): value is Grant {
  if (!value || typeof value !== 'object') return false;
  const grant = value as Record<string, unknown>;
  return typeof grant.role_code === 'string' && roles.has(grant.role_code) &&
    typeof grant.scope_type === 'string' && scopes.has(grant.scope_type) &&
    (grant.organization_id === null || (typeof grant.organization_id === 'string' && uuidPattern.test(grant.organization_id))) &&
    (grant.region_code === null || grant.region_code === undefined || (typeof grant.region_code === 'string' && grant.region_code.length <= 80)) &&
    (grant.campaign_id === null || grant.campaign_id === undefined || (typeof grant.campaign_id === 'string' && uuidPattern.test(grant.campaign_id)));
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
  private serviceToken?: { value: string; refreshAt: number };
  private tokenRequest: Promise<string> | undefined;
  private readonly introspections = new Map<string, Promise<LogisticsSession>>();

  constructor(
    @Inject(LOGISTICS_IDENTITY_CLIENT) private readonly client: CircuitBreakerClient,
    @Inject(LOGISTICS_IDENTITY_CONFIG) private readonly config: LogisticsIdentityConfig,
  ) {}

  async introspect(claims: LogisticsAccessTokenClaims): Promise<LogisticsSession> {
    const key = `${claims.sid}:${claims.sub}`;
    const existing = this.introspections.get(key);
    if (existing) return existing;
    const operation = this.fetchIntrospection(claims);
    this.introspections.set(key, operation);
    void operation.finally(() => this.introspections.delete(key)).catch(() => undefined);
    return operation;
  }

  async assertActiveRegion(code: string, userHeaders: Record<string, string>): Promise<void> {
    let cursor: string | null = null;
    const seenCursors = new Set<string>();
    for (let page = 0; page < 100; page++) {
      const path = `/api/v1/identity/regions?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      let result;
      try {
        result = await this.client.get<unknown>(path, { headers: userHeaders });
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw unavailable();
      }
      if (result.status === 401) throw new AppError('SESSION_EXPIRED', { status: 401 });
      if (result.status !== 200 || !result.body || typeof result.body !== 'object') throw unavailable();

      const body = result.body as Record<string, unknown>;
      if (!Array.isArray(body.items) || !(body.next_cursor === null || typeof body.next_cursor === 'string')) throw unavailable();
      for (const item of body.items) {
        if (!item || typeof item !== 'object') throw unavailable();
        const region = item as Record<string, unknown>;
        if (typeof region.code !== 'string' || typeof region.name !== 'string' || !['ACTIVE', 'INACTIVE'].includes(String(region.status))) {
          throw unavailable();
        }
        if (region.code === code) {
          if (region.status !== 'ACTIVE') throw new AppError('VALIDATION_FAILED', { status: 400 });
          return;
        }
      }
      const next = body.next_cursor as string | null;
      if (!next) throw new AppError('VALIDATION_FAILED', { status: 400 });
      if (seenCursors.has(next)) throw unavailable();
      seenCursors.add(next);
      cursor = next;
    }
    throw unavailable();
  }

  onModuleDestroy(): void {
    this.client.close();
  }

  private async fetchIntrospection(claims: LogisticsAccessTokenClaims): Promise<LogisticsSession> {
    const token = await this.getServiceToken();
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

  private async getServiceToken(): Promise<string> {
    if (this.serviceToken && this.serviceToken.refreshAt > Date.now()) return this.serviceToken.value;
    if (this.tokenRequest) return this.tokenRequest;
    const operation = this.client.post<unknown>('/api/v1/identity/internal/token', {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      audience: 'identity',
    }).then((result) => {
      if (result.status !== 200 || !result.body || typeof result.body !== 'object') throw unavailable();
      const value = result.body as Partial<ServiceTokenResponse>;
      if (typeof value.access_token !== 'string' || !Number.isInteger(value.expires_in) || value.expires_in! < 1) throw unavailable();
      this.serviceToken = { value: value.access_token, refreshAt: Date.now() + Math.max(1, value.expires_in! - 30) * 1_000 };
      return value.access_token;
    }).catch((error: unknown) => {
      if (error instanceof AppError) throw error;
      throw unavailable();
    }).finally(() => { this.tokenRequest = undefined; });
    this.tokenRequest = operation;
    return operation;
  }
}
