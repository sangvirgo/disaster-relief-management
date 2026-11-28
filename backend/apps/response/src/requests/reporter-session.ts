import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { Request } from 'express';
import { AppError } from '@c48/technical/errors/errors';
import { CircuitBreakerClient } from '@c48/technical/http/service-client';
import { Grant, isSubCoordinatorGrant, validGrant } from '@c48/identity-contracts/permissions';
import { ServiceTokenCache } from '@c48/technical/http/service-token-cache';
import type { ServiceName } from '@c48/technical/security/service-token';
import { RequestIntakeConfig, REQUEST_INTAKE_CONFIG } from './request-intake.service';
import { reporterAccessClaims, ReporterAccessTokenClaims } from './reporter-token';
import { ENGAGEMENT_TTL_MINUTES } from './engagement-ttl';

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

/** A coordinator who may act on a request of one campaign. `engaged` marks a sub-coordinator working that campaign. */
export interface RequestCoordinatorGrant {
  user_id: string;
  role_code: 'COORDINATOR';
  scope_type: 'SYSTEM' | 'CAMPAIGN';
  campaign_id: string | null;
  engaged?: true;
}

const activeEngagementSql = `ended_at IS NULL AND last_active_at > now()-interval '${ENGAGEMENT_TTL_MINUTES} minutes'`;

export type TeamLeaderEligibilityReason = 'USER_NOT_FOUND' | 'USER_INACTIVE' | 'VOLUNTEER_GRANT_REQUIRED';

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
    @Optional() @InjectDataSource() private readonly dataSource?: DataSource,
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

  async requestCoordinatorGrants(campaignId: string | null): Promise<RequestCoordinatorGrant[]> {
    const token = await this.serviceTokens.get();
    let result;
    try {
      result = await this.client.post<unknown>('/api/v1/identity/internal/request-coordinators', { campaign_id: campaignId }, {
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
      if (typeof value.user_id !== 'string' || !uuidPattern.test(value.user_id)) return false;
      return value.role_code === 'COORDINATOR' && ['SYSTEM', 'CAMPAIGN'].includes(String(value.scope_type)) &&
        (value.scope_type === 'SYSTEM' ? value.campaign_id === null :
          (value.campaign_id === null && campaignId !== null) ||
          (typeof value.campaign_id === 'string' && uuidPattern.test(value.campaign_id) && value.campaign_id === campaignId));
    });
    if (!valid) throw unavailable();
    const all = items as RequestCoordinatorGrant[];
    const fixed = all.filter((grant) => !(grant.scope_type === 'CAMPAIGN' && grant.campaign_id === null));
    const subUserIds = [...new Set(all.filter((grant) => grant.scope_type === 'CAMPAIGN' && grant.campaign_id === null).map((grant) => grant.user_id))];
    if (!campaignId || !subUserIds.length || !this.dataSource) return fixed;
    // Identity only knows the floating grant; the campaign a sub-coordinator works on lives in the Response database.
    const engaged = (await this.dataSource.query(
      `SELECT DISTINCT user_id FROM campaign_engagement WHERE campaign_id=$1 AND user_id=ANY($2::uuid[]) AND ${activeEngagementSql}`,
      [campaignId, subUserIds],
    ) as Array<{ user_id: string }>).map(({ user_id }) => user_id);
    return [...fixed, ...engaged.map((userId): RequestCoordinatorGrant => ({
      user_id: userId, role_code: 'COORDINATOR', scope_type: 'CAMPAIGN', campaign_id: campaignId, engaged: true,
    }))];
  }

  async teamLeaderEligibility(userId: string): Promise<TeamLeaderEligibility> {
    const token = await this.serviceTokens.get();
    let result;
    try {
      result = await this.client.post<unknown>('/api/v1/identity/internal/team-leader-eligibility', { user_id: userId }, {
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
    const reasons: TeamLeaderEligibilityReason[] = ['USER_NOT_FOUND', 'USER_INACTIVE', 'VOLUNTEER_GRANT_REQUIRED'];
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
        query: query.trim(), ...(cursor ? { cursor } : {}), limit, role_code: 'VOLUNTEER',
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
    const grants = value.grants as Grant[];
    return { userId: claims.sub, grants: [...grants, ...await this.engagedGrants(claims.sub, grants)] };
  }

  /**
   * A sub-coordinator (floating COORDINATOR campaign grant) acts only inside the ACTIVE campaigns it is engaged in.
   * Each such engagement becomes a campaign grant marked `engaged`, which carries SUB_COORDINATOR_PERMISSIONS only, so
   * every existing campaign-scope check applies unchanged. Activity keeps the engagement alive (at most one write a minute).
   */
  private async engagedGrants(userId: string, grants: readonly Grant[]): Promise<Grant[]> {
    if (!this.dataSource || !grants.some(isSubCoordinatorGrant)) return [];
    await this.dataSource.query(
      `UPDATE campaign_engagement ce SET last_active_at=now()
         FROM campaign c
        WHERE c.id=ce.campaign_id AND c.status='ACTIVE' AND ce.user_id=$1 AND ce.ended_at IS NULL
          AND ce.last_active_at > now()-interval '${ENGAGEMENT_TTL_MINUTES} minutes'
          AND ce.last_active_at < now()-interval '1 minute'`, [userId],
    );
    const active = await this.dataSource.query(
      `SELECT DISTINCT ce.campaign_id FROM campaign_engagement ce JOIN campaign c ON c.id=ce.campaign_id
        WHERE ce.user_id=$1 AND c.status='ACTIVE' AND ce.ended_at IS NULL
          AND ce.last_active_at > now()-interval '${ENGAGEMENT_TTL_MINUTES} minutes'`, [userId],
    ) as Array<{ campaign_id: string }>;
    return active.map(({ campaign_id }): Grant => ({ role_code: 'COORDINATOR', scope_type: 'CAMPAIGN', campaign_id, engaged: true }));
  }

}
