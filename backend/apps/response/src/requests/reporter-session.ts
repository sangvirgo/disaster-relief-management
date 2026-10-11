import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../../../../packages/technical/src/errors';
import { CircuitBreakerClient } from '../../../../packages/technical/src/service-client';
import type { Grant } from '../../../../packages/technical/src/permissions';
import { RequestIntakeConfig, REQUEST_INTAKE_CONFIG } from './request-intake.service';
import { reporterAccessClaims, ReporterAccessTokenClaims } from './reporter-token';

export const REPORTER_SESSION_CONFIG = Symbol('REPORTER_SESSION_CONFIG');

export interface ReporterSessionConfig {
  identityBaseUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
}

export interface ReporterSession {
  userId: string;
  grants: Grant[];
}

export interface RequestCoordinatorGrant {
  user_id: string;
  role_code: 'COORDINATOR' | 'OPERATIONS_MANAGER';
  scope_type: 'ORGANIZATION' | 'REGION' | 'CAMPAIGN';
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
}

interface IdentityServiceToken {
  access_token: string;
  expires_in: number;
}

const roles = new Set(['CITIZEN', 'VOLUNTEER', 'COORDINATOR', 'CAMPAIGN_MANAGER', 'OPERATIONS_MANAGER', 'INTAKE_STAFF', 'REVIEWER', 'DISTRIBUTION_STAFF', 'ADMIN']);
const scopeTypes = new Set(['SYSTEM', 'ORGANIZATION', 'REGION', 'CAMPAIGN']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unavailable(): AppError {
  return new AppError('IDENTITY_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
}

function validGrant(value: unknown): value is Grant {
  if (!value || typeof value !== 'object') return false;
  const grant = value as Record<string, unknown>;
  return typeof grant.role_code === 'string' && roles.has(grant.role_code) &&
    typeof grant.scope_type === 'string' && scopeTypes.has(grant.scope_type) &&
    (grant.organization_id === null || (typeof grant.organization_id === 'string' && uuidPattern.test(grant.organization_id))) &&
    (grant.region_code === null || grant.region_code === undefined || (typeof grant.region_code === 'string' && grant.region_code.length <= 80)) &&
    (grant.campaign_id === null || grant.campaign_id === undefined || (typeof grant.campaign_id === 'string' && uuidPattern.test(grant.campaign_id)));
}

export function loadReporterSessionConfig(env: Record<string, string | undefined> = process.env): ReporterSessionConfig {
  const identityBaseUrl = env.IDENTITY_BASE_URL ?? '';
  const clientId = env.RESPONSE_SERVICE_CLIENT_ID ?? '';
  const clientSecret = env.RESPONSE_SERVICE_CLIENT_SECRET ?? '';
  const timeoutMs = Number(env.INTROSPECT_TIMEOUT_MS ?? 500);
  try {
    const url = new URL(identityBaseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !clientId || clientId.length > 64 || clientSecret.length < 32 || clientSecret.length > 256 ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 2_000) throw new Error('invalid');
  } catch {
    throw new Error('Invalid Response configuration: IDENTITY_BASE_URL, RESPONSE_SERVICE_CLIENT_ID, RESPONSE_SERVICE_CLIENT_SECRET, INTROSPECT_TIMEOUT_MS');
  }
  return { identityBaseUrl, clientId, clientSecret, timeoutMs };
}

@Injectable()
export class ReporterSessionService implements OnModuleDestroy {
  private readonly client: CircuitBreakerClient;
  private serviceToken?: { value: string; refreshAt: number };
  private tokenRequest: Promise<string> | undefined;
  private readonly inFlight = new Map<string, Promise<ReporterSession>>();

  constructor(
    @Inject(REPORTER_SESSION_CONFIG) private readonly config: ReporterSessionConfig,
    @Inject(REQUEST_INTAKE_CONFIG) private readonly intakeConfig: RequestIntakeConfig,
  ) {
    this.client = new CircuitBreakerClient(config.identityBaseUrl, 'IDENTITY_UNAVAILABLE', { timeoutMs: config.timeoutMs, maxSockets: 30 });
  }

  async optional(request: Request, hasTrackingCapability = false): Promise<ReporterSession | null> {
    if (hasTrackingCapability) return null;
    const claims = reporterAccessClaims(request, this.intakeConfig.auth);
    return claims ? this.introspect(claims) : null;
  }

  async require(request: Request): Promise<ReporterSession> {
    const session = await this.optional(request);
    if (!session) throw new AppError('UNAUTHENTICATED', { status: 401 });
    return session;
  }

  async requestCoordinatorGrants(organizationId: string): Promise<RequestCoordinatorGrant[]> {
    const token = await this.getServiceToken();
    let result;
    try {
      result = await this.client.post<unknown>('/api/v1/identity/internal/request-coordinators', { organization_id: organizationId }, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailable();
    }
    if (result.status !== 200 || !result.body || typeof result.body !== 'object' || !Array.isArray((result.body as Record<string, unknown>).items)) {
      throw unavailable();
    }
    const items = (result.body as { items: unknown[] }).items;
    const valid = items.every((item) => {
      if (!item || typeof item !== 'object') return false;
      const value = item as Record<string, unknown>;
      return typeof value.user_id === 'string' && uuidPattern.test(value.user_id) &&
        (value.role_code === 'COORDINATOR' || value.role_code === 'OPERATIONS_MANAGER') &&
        ['ORGANIZATION', 'REGION', 'CAMPAIGN'].includes(String(value.scope_type)) &&
        value.organization_id === organizationId &&
        (value.region_code === null || typeof value.region_code === 'string') &&
        (value.campaign_id === null || (typeof value.campaign_id === 'string' && uuidPattern.test(value.campaign_id)));
    });
    if (!valid) throw unavailable();
    return items as RequestCoordinatorGrant[];
  }

  onModuleDestroy(): void {
    this.client.close();
  }

  private async introspect(claims: ReporterAccessTokenClaims): Promise<ReporterSession> {
    const key = `${claims.sid}:${claims.sub}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const operation = this.fetchIntrospection(claims);
    this.inFlight.set(key, operation);
    void operation.finally(() => this.inFlight.delete(key)).catch(() => undefined);
    return operation;
  }

  private async fetchIntrospection(claims: ReporterAccessTokenClaims): Promise<ReporterSession> {
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
    if (result.status >= 500) throw unavailable();
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
      const value = result.body as Partial<IdentityServiceToken>;
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
