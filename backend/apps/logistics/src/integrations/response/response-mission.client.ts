import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '@c48/technical/errors/errors';
import { LogisticsIdentityService } from '../../auth/logistics-identity.service';
import { LOGISTICS_RESPONSE_CLIENT } from './response-campaign.client';
import type { CircuitBreakerClient } from '@c48/technical/http/service-client';

export const MISSION_STATUSES = ['OFFERED', 'ACCEPTED', 'EN_ROUTE', 'ON_SCENE', 'COMPLETED', 'FAILED', 'DECLINED', 'CANCELLED'] as const;

/** Allowlisted projection returned by Response GET /internal/missions/:id. No contact data or free text. */
export interface ResponseMission {
  id: string;
  status: (typeof MISSION_STATUSES)[number];
  request_id: string;
  campaign_id: string | null;
  team_id: string;
  work_cycle: number;
  member_user_ids: string[];
}

function unavailable(): AppError {
  return new AppError('RESPONSE_UNAVAILABLE', { status: 503, retryAfterSeconds: 1 });
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

@Injectable()
export class LogisticsResponseMissionClient {
  constructor(
    @Inject(LOGISTICS_RESPONSE_CLIENT) private readonly client: CircuitBreakerClient,
    private readonly identity: LogisticsIdentityService,
  ) {}

  async getMission(id: string): Promise<ResponseMission> {
    if (!uuidPattern.test(id)) throw new AppError('PICKUP_MISSION_NOT_FOUND', { status: 404 });
    let result;
    try {
      const token = await this.identity.serviceToken('response');
      result = await this.client.get<unknown>(`/api/v1/response/internal/missions/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch (error) {
      if (error instanceof AppError && error.code === 'RESPONSE_UNAVAILABLE') throw error;
      throw unavailable();
    }
    if (result.status === 404) throw new AppError('PICKUP_MISSION_NOT_FOUND', { status: 404 });
    if (result.status !== 200 || !result.body || typeof result.body !== 'object') throw unavailable();
    const value = result.body as Record<string, unknown>;
    const members = value.member_user_ids;
    const campaignId = value.campaign_id;
    if (value.id !== id || typeof value.request_id !== 'string' || typeof value.team_id !== 'string' ||
        !Number.isInteger(value.work_cycle) || !(MISSION_STATUSES as readonly string[]).includes(String(value.status)) ||
        !(campaignId === null || typeof campaignId === 'string') || !Array.isArray(members) ||
        !members.every((member) => typeof member === 'string')) throw unavailable();
    return {
      id,
      status: value.status as ResponseMission['status'],
      request_id: value.request_id,
      campaign_id: campaignId,
      team_id: value.team_id,
      work_cycle: value.work_cycle as number,
      member_user_ids: members as string[],
    };
  }
}
