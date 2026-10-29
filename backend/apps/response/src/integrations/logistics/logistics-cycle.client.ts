import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '@c48/technical/errors/errors';
import { CircuitBreakerClient } from '@c48/technical/http/service-client';
import { ReporterSessionService } from '../../requests/reporter-session';

export const LOGISTICS_CYCLE_CONFIG = Symbol('LOGISTICS_CYCLE_CONFIG');

export type ResolutionOutcomeBasis = 'RESCUE_COMPLETED' | 'SUPPLY_ONLY' | 'NO_ACTION_REQUIRED';
export type CycleIntentCommand = { intent_id: string };
export type SealCycleCommand = CycleIntentCommand & { outcome_basis: ResolutionOutcomeBasis };
export interface FulfillmentNeedEvidence {
  status: string;
  delivered: string;
  reserved: string;
  unsettledIssued: string;
}

export interface LogisticsCycleClientConfig {
  baseUrl: string;
  timeoutMs: number;
}

const knownUpstreamErrors: Record<string, number> = {
  CYCLE_NOT_SETTLED: 409,
  CYCLE_FROZEN: 409,
  CYCLE_SEALED: 409,
  STATE_TRANSITION_INVALID: 409,
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const outcomeBases = new Set<ResolutionOutcomeBasis>(['RESCUE_COMPLETED', 'SUPPLY_ONLY', 'NO_ACTION_REQUIRED']);

function unavailable(): AppError {
  return new AppError('LOGISTICS_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
}

export function loadLogisticsCycleConfig(env: Record<string, string | undefined> = process.env): LogisticsCycleClientConfig {
  const baseUrl = env.LOGISTICS_BASE_URL ?? '';
  const timeoutMs = Number(env.INTROSPECT_TIMEOUT_MS ?? 500);
  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 2_000) {
      throw new Error('invalid');
    }
  } catch {
    throw new Error('Invalid Response configuration: LOGISTICS_BASE_URL, INTROSPECT_TIMEOUT_MS');
  }
  return { baseUrl, timeoutMs };
}

@Injectable()
export class LogisticsCycleClient implements OnModuleDestroy {
  private readonly client: CircuitBreakerClient;

  constructor(
    @Inject(LOGISTICS_CYCLE_CONFIG) config: LogisticsCycleClientConfig,
    private readonly sessions: ReporterSessionService,
  ) {
    this.client = new CircuitBreakerClient(config.baseUrl, 'LOGISTICS_UNAVAILABLE', { timeoutMs: config.timeoutMs, maxSockets: 10 });
  }

  freeze(requestId: string, workCycle: number, command: CycleIntentCommand): Promise<void> {
    return this.execute('freeze', requestId, workCycle, command);
  }

  seal(requestId: string, workCycle: number, command: SealCycleCommand): Promise<void> {
    return this.execute('seal', requestId, workCycle, command);
  }

  unseal(requestId: string, workCycle: number, command: CycleIntentCommand): Promise<void> {
    return this.execute('unseal', requestId, workCycle, command);
  }

  async fulfillment(requestId: string, workCycle: number, request: Request): Promise<FulfillmentNeedEvidence[]> {
    if (!uuidPattern.test(requestId) || !Number.isSafeInteger(workCycle) || workCycle < 1) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
    const actorToken = this.actorAccessToken(request);
    const token = await this.sessions.serviceToken('logistics');
    const result = await this.client.get<unknown>(
      `/api/v1/logistics/internal/requests/${encodeURIComponent(requestId)}/fulfillment?work_cycle=${workCycle}`,
      { headers: { authorization: `Bearer ${token}`, 'x-actor-authorization': `Bearer ${actorToken}` } },
    );
    if (result.status === 404) return [];
    if (result.status !== 200 || !result.body || typeof result.body !== 'object' ||
        !Array.isArray((result.body as Record<string, unknown>).needs)) throw this.upstreamError(result.status, result.body);
    const needs = (result.body as { needs: unknown[] }).needs;
    if (!needs.every((need) => {
      if (!need || typeof need !== 'object' || Array.isArray(need)) return false;
      const row = need as Record<string, unknown>;
      return typeof row.status === 'string' && typeof row.delivered === 'string' &&
        typeof row.committed_reserved === 'string' && typeof row.issued_unsettled === 'string';
    })) throw unavailable();
    return needs.map((need) => {
      const row = need as Record<string, string>;
      return { status: row.status!, delivered: row.delivered!, reserved: row.committed_reserved!, unsettledIssued: row.issued_unsettled! };
    });
  }

  onModuleDestroy(): void {
    this.client.close();
  }

  private async execute(
    action: 'freeze' | 'seal' | 'unseal',
    requestId: string,
    workCycle: number,
    command: CycleIntentCommand | SealCycleCommand,
  ): Promise<void> {
    const expectedKeys = action === 'seal' ? ['intent_id', 'outcome_basis'] : ['intent_id'];
    if (!uuidPattern.test(requestId) || !Number.isSafeInteger(workCycle) || workCycle < 1 ||
        !command || typeof command !== 'object' || Array.isArray(command) ||
        !uuidPattern.test(command.intent_id) || Object.keys(command).sort().join(',') !== expectedKeys.sort().join(',') ||
        (action === 'seal' && !outcomeBases.has((command as SealCycleCommand).outcome_basis))) {
      throw new AppError('VALIDATION_FAILED', { status: 400 });
    }
    const token = await this.sessions.serviceToken('logistics');
    let result;
    try {
      result = await this.client.post<unknown>(
        `/api/v1/logistics/internal/requests/${encodeURIComponent(requestId)}/cycles/${workCycle}/${action}`,
        command,
        { headers: { authorization: `Bearer ${token}` } },
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailable();
    }
    if (result.status !== 200) throw this.upstreamError(result.status, result.body);
  }

  private actorAccessToken(request: Request): string {
    const authorization = Array.isArray(request.headers.authorization) ? request.headers.authorization[0] : request.headers.authorization;
    const bearer = authorization?.match(/^Bearer ([A-Za-z0-9_.-]+)$/iu)?.[1];
    if (bearer) return bearer;
    const cookieHeader = Array.isArray(request.headers.cookie) ? request.headers.cookie[0] : request.headers.cookie;
    const accessCookie = cookieHeader?.split(';').map((part: string) => part.trim()).find((part: string) => part.startsWith('c48_access='));
    const cookieToken = accessCookie?.slice('c48_access='.length);
    if (cookieToken && /^[A-Za-z0-9_.-]+$/u.test(cookieToken)) return cookieToken;
    throw new AppError('UNAUTHENTICATED', { status: 401 });
  }

  private upstreamError(status: number, body: unknown): AppError {
    if (body && typeof body === 'object') {
      const value = body as Record<string, unknown>;
      if (typeof value.code === 'string' && knownUpstreamErrors[value.code] === status) {
        const reasons = value.code === 'CYCLE_NOT_SETTLED' && value.details && typeof value.details === 'object'
          ? (value.details as Record<string, unknown>).reasons
          : undefined;
        const details = Array.isArray(reasons) && reasons.length <= 20 && reasons.every((reason) => typeof reason === 'string')
          ? { reasons }
          : undefined;
        return new AppError(value.code, { status, ...(details ? { details } : {}) });
      }
    }
    return unavailable();
  }
}
