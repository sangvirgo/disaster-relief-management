import { describe, expect, it, jest } from '@jest/globals';
import { AppError } from '@c48/technical/errors/errors';
import { LogisticsResponseMissionClient } from '../src/integrations/response/response-mission.client';

const MISSION = '50000000-0000-4000-8000-000000000001';
const REQUEST = '50000000-0000-4000-8000-000000000002';
const CAMPAIGN = '50000000-0000-4000-8000-000000000003';
const TEAM = '50000000-0000-4000-8000-000000000004';
const MEMBER = '50000000-0000-4000-8000-000000000005';

function client(response: { status: number; body?: unknown }) {
  const get = jest.fn(async () => response);
  const identity = { serviceToken: jest.fn(async () => 'token') };
  return { service: new LogisticsResponseMissionClient({ get } as never, identity as never), get };
}

const valid = { id: MISSION, status: 'ACCEPTED', request_id: REQUEST, campaign_id: CAMPAIGN, team_id: TEAM, work_cycle: 1, member_user_ids: [MEMBER] };

describe('LogisticsResponseMissionClient.getMission', () => {
  it('calls the internal mission route with a service token and returns the projection', async () => {
    const { service, get } = client({ status: 200, body: valid });
    expect(await service.getMission(MISSION)).toEqual(valid);
    expect(get).toHaveBeenCalledWith(`/api/v1/response/internal/missions/${MISSION}`, { headers: { authorization: 'Bearer token' } });
  });

  it('maps a 404 from Response to PICKUP_MISSION_NOT_FOUND', async () => {
    const { service } = client({ status: 404 });
    await expect(service.getMission(MISSION)).rejects.toMatchObject({ code: 'PICKUP_MISSION_NOT_FOUND', status: 404 });
  });

  it('treats a projection with an unknown status or a malformed roster as unavailable', async () => {
    await expect(client({ status: 200, body: { ...valid, status: 'LEAKED' } }).service.getMission(MISSION))
      .rejects.toMatchObject({ code: 'RESPONSE_UNAVAILABLE', status: 503 });
    await expect(client({ status: 200, body: { ...valid, member_user_ids: 'x' } }).service.getMission(MISSION))
      .rejects.toBeInstanceOf(AppError);
    await expect(client({ status: 200, body: { ...valid, id: REQUEST } }).service.getMission(MISSION))
      .rejects.toMatchObject({ code: 'RESPONSE_UNAVAILABLE' });
  });

  it('accepts an unassigned mission with a null campaign', async () => {
    const { service } = client({ status: 200, body: { ...valid, campaign_id: null } });
    expect(await service.getMission(MISSION)).toMatchObject({ campaign_id: null });
  });
});
