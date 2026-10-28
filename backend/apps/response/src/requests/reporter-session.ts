import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { CircuitBreakerClient } from '../../../../packages/technical/src/http/service-client';
import { Grant, validGrant } from '../../../../packages/identity-contracts/src/permissions';
import { ServiceTokenCache } from '../../../../packages/technical/src/http/service-token-cache';
import type { ServiceName } from '../../../../packages/technical/src/security/service-token';
import { RequestIntakeConfig, REQUEST_INTAKE_CONFIG } from './request-intake.service';
import { reporterAccessClaims, ReporterAccessTokenClaims } from './reporter-token';

export const REPORTER_SESSION_CLIENT = Symbol('REPORTER_SESSION_CLIENT');
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

export type TeamLeaderEligibilityReason = 'USER_NOT_FOUND' | 'USER_INACTIVE' | 'MEMBERSHIP_REQUIRED' | 'VOLUNTEER_GRANT_REQUIRED';

export type TeamLeaderEligibility =
  | { eligible: true }
  | { eligible: false; reason: TeamLeaderEligibilityReason };

export type ActiveUserCheck =
  | { active: true }
  | { active: false; reason: 'USER_NOT_FOUND' | 'USER_INACTIVE' };

export interface IdentityUserProfile {
  id: string;
  display_name: string;
}

export interface ActiveUserSearchResult {
  items: Array<{ id: string; username: string; display_name: string }>;
  more: boolean;
  cursor?: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unavailable(): AppError {
  return new AppError('IDENTITY_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
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
  private readonly serviceTokens: ServiceTokenCache;
  private readonly inFlight = new Map<string, Promise<ReporterSession>>();

  constructor(
    @Inject(REPORTER_SESSION_CONFIG) config: ReporterSessionConfig,
    @Inject(REQUEST_INTAKE_CONFIG) private readonly intakeConfig: RequestIntakeConfig,
    @Inject(REPORTER_SESSION_CLIENT) private readonly client: CircuitBreakerClient,
  ) {
    this.serviceTokens = new ServiceTokenCache(client, config);
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

  serviceToken(audience: ServiceName): Promise<string> {
    return this.serviceTokens.get(audience);
  }

  async requestCoordinatorGrants(organizationId: string): Promise<RequestCoordinatorGrant[]> {
    const token = await this.serviceTokens.get();
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

  async lookupRegionNames(codes: string[]): Promise<Map<string, string>> {
    const requested = [...new Set(codes)];
    if (!requested.length) return new Map();

    const token = await this.serviceTokens.get();
    let result;
    try {
      result = await this.client.post<unknown>('/api/v1/identity/internal/regions:lookup', { codes: requested }, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailable();
    }
    if (result.status !== 200 || !result.body || typeof result.body !== 'object') throw unavailable();
    const items = (result.body as Record<string, unknown>).items;
    if (!Array.isArray(items)) throw unavailable();

    const requestedCodes = new Set(requested);
    const names = new Map<string, string>();
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw unavailable();
      const region = item as Record<string, unknown>;
      if (typeof region.code !== 'string' || !requestedCodes.has(region.code) ||
          typeof region.name !== 'string' || !region.name.trim() || names.has(region.code)) throw unavailable();
      names.set(region.code, region.name);
    }
    return names;
  }

  async teamLeaderEligibility(userId: string, organizationId: string): Promise<TeamLeaderEligibility> {
    const token = await this.serviceTokens.get();
    let result;
    try {
      result = await this.client.post<unknown>('/api/v1/identity/internal/team-leader-eligibility', {
        user_id: userId,
        organization_id: organizationId,
      }, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailable();
    }
    if (result.status !== 200 || !result.body || typeof result.body !== 'object') {
      throw unavailable();
    }
    const value = result.body as Record<string, unknown>;
    const keys = Object.keys(value).sort().join(',');
    if (value.eligible === true && keys === 'eligible') return { eligible: true };
    const reasons: TeamLeaderEligibilityReason[] = ['USER_NOT_FOUND', 'USER_INACTIVE', 'MEMBERSHIP_REQUIRED', 'VOLUNTEER_GRANT_REQUIRED'];
    if (value.eligible === false && keys === 'eligible,reason' && reasons.includes(value.reason as TeamLeaderEligibilityReason)) {
      return { eligible: false, reason: value.reason as TeamLeaderEligibilityReason };
    }
    throw unavailable();
  }

  async activeUserCheck(userId: string): Promise<ActiveUserCheck> {
    const token = await this.serviceTokens.get();
    let result;
    try {
      result = await this.client.post<unknown>('/api/v1/identity/internal/users:check-active', { user_id: userId }, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailable();
    }
    if (result.status !== 200 || !result.body || typeof result.body !== 'object') throw unavailable();
    const value = result.body as Record<string, unknown>;
    const keys = Object.keys(value).sort().join(',');
    if (value.active === true && keys === 'active') return { active: true };
    if (value.active === false && keys === 'active,reason' && ['USER_NOT_FOUND', 'USER_INACTIVE'].includes(String(value.reason))) {
      return { active: false, reason: value.reason as 'USER_NOT_FOUND' | 'USER_INACTIVE' };
    }
    throw unavailable();
  }

  async lookupUsers(ids: string[]): Promise<IdentityUserProfile[]> {
    const requested = [...new Set(ids)];
    if (!requested.length) return [];
    if (requested.length > 100) throw new AppError('INTERNAL_ERROR', { status: 500 });

    const token = await this.serviceTokens.get();
    let result;
    try {
      result = await this.client.post<unknown>('/api/v1/identity/internal/users:lookup', { ids: requested }, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailable();
    }
    if (result.status !== 200 || !result.body || typeof result.body !== 'object') throw unavailable();
    const items = (result.body as Record<string, unknown>).items;
    if (!Array.isArray(items)) throw unavailable();
    const expected = new Set(requested);
    const seen = new Set<string>();
    const profiles = items.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw unavailable();
      const value = item as Record<string, unknown>;
      if (Object.keys(value).sort().join(',') !== 'display_name,id' ||
          typeof value.id !== 'string' || !uuidPattern.test(value.id) || !expected.has(value.id) || seen.has(value.id) ||
          typeof value.display_name !== 'string' || !value.display_name.trim()) throw unavailable();
      seen.add(value.id);
      return { id: value.id, display_name: value.display_name };
    });
    if (seen.size !== expected.size) throw unavailable();
    return profiles;
  }

  async searchActiveUsers(query: string, cursor?: string, limit = 50): Promise<ActiveUserSearchResult> {
    const token = await this.serviceTokens.get();
    let result;
    try {
      result = await this.client.post<unknown>('/api/v1/identity/internal/users:search', {
        query: query.trim(), ...(cursor ? { cursor } : {}), limit,
      }, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailable();
    }
    if (result.status !== 200 || !result.body || typeof result.body !== 'object') throw unavailable();
    const value = result.body as Record<string, unknown>;
    if (!Array.isArray(value.items) || typeof value.more !== 'boolean' ||
        (value.cursor !== undefined && typeof value.cursor !== 'string') || value.more !== (typeof value.cursor === 'string')) {
      throw unavailable();
    }
    const items = value.items.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw unavailable();
      const user = item as Record<string, unknown>;
      if (Object.keys(user).sort().join(',') !== 'display_name,id,username' ||
          typeof user.id !== 'string' || !uuidPattern.test(user.id) ||
          typeof user.username !== 'string' || !user.username.trim() ||
          typeof user.display_name !== 'string' || !user.display_name.trim()) throw unavailable();
      return { id: user.id, username: user.username, display_name: user.display_name };
    });
    return { items, more: value.more, ...(typeof value.cursor === 'string' ? { cursor: value.cursor } : {}) };
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
    const token = await this.serviceTokens.get();
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

}
