import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { CircuitBreakerClient } from '../../../../packages/technical/src/http/service-client';
import { LogisticsIdentityService } from '../auth/logistics-identity.service';

export const RESPONSE_ADMISSION_CLIENT = Symbol('RESPONSE_ADMISSION_CLIENT');
export const RESPONSE_ADMISSION_CONFIG = Symbol('RESPONSE_ADMISSION_CONFIG');

export interface ResponseAdmissionConfig {
  baseUrl: string;
  timeoutMs: number;
}

export interface ResponseAdmission {
  request_id: string;
  work_cycle: number;
  version: number;
  status: 'VERIFIED' | 'TRIAGED' | 'DISPATCHED' | 'IN_PROGRESS';
  organization_id: string;
  region_code: string | null;
  campaign_id: string | null;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const eligibleStatuses = new Set<ResponseAdmission['status']>(['VERIFIED', 'TRIAGED', 'DISPATCHED', 'IN_PROGRESS']);
const upstreamErrors: Record<string, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  STATE_TRANSITION_INVALID: 409,
  REQUEST_NOT_VERIFIED: 409,
  PENDING_SUPPLEMENT_REVIEW: 409,
};

export function loadResponseAdmissionConfig(env: Record<string, string | undefined> = process.env): ResponseAdmissionConfig {
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

function unavailable(): AppError {
  return new AppError('RESPONSE_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
}

function actorBearer(identityHeaders: Record<string, string>): string {
  const authorization = identityHeaders.authorization;
  if (authorization && /^Bearer [A-Za-z0-9_.-]+$/u.test(authorization)) return authorization;

  const cookie = identityHeaders.cookie;
  const accessToken = cookie?.split(';').map((part) => part.trim())
    .find((part) => part.startsWith('c48_access='))?.slice('c48_access='.length);
  if (accessToken && /^[A-Za-z0-9_.-]+$/u.test(accessToken)) return `Bearer ${accessToken}`;
  throw new AppError('UNAUTHENTICATED', { status: 401 });
}

function responseError(status: number, body: unknown): AppError {
  if (body && typeof body === 'object') {
    const code = (body as Record<string, unknown>).code;
    if (typeof code === 'string' && upstreamErrors[code] === status) return new AppError(code, { status });
  }
  return unavailable();
}

@Injectable()
export class ResponseAdmissionClient implements OnModuleDestroy {
  constructor(
    @Inject(RESPONSE_ADMISSION_CLIENT) private readonly client: CircuitBreakerClient,
    private readonly identity: LogisticsIdentityService,
  ) {}

  async admit(requestId: string, workCycle: number, identityHeaders: Record<string, string>): Promise<ResponseAdmission> {
    if (!Number.isSafeInteger(workCycle) || workCycle < 1) throw new AppError('VALIDATION_FAILED', { status: 400 });
    const actorAuthorization = actorBearer(identityHeaders);
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
        `/api/v1/response/internal/requests/${encodeURIComponent(requestId)}/cycles/${workCycle}/admit`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${serviceToken}`,
            'x-actor-authorization': actorAuthorization,
          },
        },
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailable();
    }
    if (result.status !== 200) throw responseError(result.status, result.body);
    return this.admissionValue(result.body, requestId, workCycle);
  }

  onModuleDestroy(): void {
    this.client.close();
  }

  private admissionValue(value: unknown, requestId: string, workCycle: number): ResponseAdmission {
    if (!value || typeof value !== 'object') throw unavailable();
    const row = value as Record<string, unknown>;
    if (row.request_id !== requestId || row.work_cycle !== workCycle ||
        typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1 ||
        typeof row.status !== 'string' || !eligibleStatuses.has(row.status as ResponseAdmission['status']) ||
        typeof row.organization_id !== 'string' || !uuidPattern.test(row.organization_id) ||
        !(row.region_code === null || typeof row.region_code === 'string') ||
        !(row.campaign_id === null || (typeof row.campaign_id === 'string' && uuidPattern.test(row.campaign_id)))) {
      throw unavailable();
    }
    return row as unknown as ResponseAdmission;
  }
}
