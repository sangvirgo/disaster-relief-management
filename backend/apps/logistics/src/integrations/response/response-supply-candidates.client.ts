import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '@c48/technical/errors/errors';
import { CircuitBreakerClient } from '@c48/technical/http/service-client';
import { LogisticsIdentityService } from '../../auth/logistics-identity.service';
import { LOGISTICS_RESPONSE_CLIENT } from './response-campaign.client';

/** Projection of Response GET /internal/requests/supply-candidates. Read-only: the scan sets no lock and no version. */
export interface SupplyCandidate {
  request_id: string;
  work_cycle: number;
  campaign_id: string | null;
  status: string;
  people_affected: number | null;
  children_count: number | null;
  elderly_count: number | null;
  relief_items_text: string | null;
  verified_at: string | null;
}

export interface SupplyCandidatePage {
  items: SupplyCandidate[];
  more: boolean;
  cursor: string | null;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const candidateStatuses = new Set(['VERIFIED', 'TRIAGED', 'DISPATCHED', 'IN_PROGRESS']);

function unavailable(): AppError {
  return new AppError('RESPONSE_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
}

function nullableCount(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function candidateValue(value: unknown): SupplyCandidate {
  if (!value || typeof value !== 'object') throw unavailable();
  const row = value as Record<string, unknown>;
  if (typeof row.request_id !== 'string' || !uuidPattern.test(row.request_id) ||
      typeof row.work_cycle !== 'number' || !Number.isSafeInteger(row.work_cycle) || row.work_cycle < 1 ||
      !(row.campaign_id === null || (typeof row.campaign_id === 'string' && uuidPattern.test(row.campaign_id))) ||
      typeof row.status !== 'string' || !candidateStatuses.has(row.status) ||
      !nullableCount(row.people_affected) || !nullableCount(row.children_count) || !nullableCount(row.elderly_count) ||
      !(row.relief_items_text === null || (typeof row.relief_items_text === 'string' && row.relief_items_text.length <= 500)) ||
      !(row.verified_at === null || typeof row.verified_at === 'string')) {
    throw unavailable();
  }
  return {
    request_id: row.request_id,
    work_cycle: row.work_cycle,
    campaign_id: row.campaign_id as string | null,
    status: row.status,
    people_affected: row.people_affected as number | null,
    children_count: row.children_count as number | null,
    elderly_count: row.elderly_count as number | null,
    relief_items_text: row.relief_items_text as string | null,
    verified_at: row.verified_at as string | null,
  };
}

@Injectable()
export class LogisticsResponseSupplyCandidatesClient {
  constructor(
    @Inject(LOGISTICS_RESPONSE_CLIENT) private readonly client: CircuitBreakerClient,
    private readonly identity: LogisticsIdentityService,
  ) {}

  async list(cursor: string | null, limit: number): Promise<SupplyCandidatePage> {
    let token: string;
    try {
      token = await this.identity.serviceToken('response');
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailable();
    }
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set('cursor', cursor);
    let result;
    try {
      result = await this.client.get<unknown>(`/api/v1/response/internal/requests/supply-candidates?${query.toString()}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch {
      throw unavailable();
    }
    if (result.status !== 200 || !result.body || typeof result.body !== 'object') throw unavailable();
    const body = result.body as Record<string, unknown>;
    if (!Array.isArray(body.items) || typeof body.more !== 'boolean' ||
        !(body.cursor === undefined || body.cursor === null || typeof body.cursor === 'string')) {
      throw unavailable();
    }
    return {
      items: body.items.map(candidateValue),
      more: body.more,
      cursor: typeof body.cursor === 'string' ? body.cursor : null,
    };
  }
}
