import { describe, expect, it, jest } from '@jest/globals';
import { MissionsQueriesService } from '../src/missions/missions-queries.service';
import { MissionsController } from '../src/missions/missions.controller';
import { ResponseServiceTokenGuard } from '../src/campaigns/service-token.guard';

const missionId = '00000000-0000-4000-8000-000000000301';
const requestId = '00000000-0000-4000-8000-000000000302';
const campaignId = '00000000-0000-4000-8000-000000000303';
const teamId = '00000000-0000-4000-8000-000000000304';
const leaderId = '00000000-0000-4000-8000-000000000305';
const memberId = '00000000-0000-4000-8000-000000000306';

function queries(rows: unknown[][]) {
  const query = jest.fn(async () => rows.shift() ?? []);
  const service = new MissionsQueriesService({ query } as never, {} as never, {} as never);
  return { service, query };
}

describe('internal mission projection (Logistics read, service token only)', () => {
  it('returns exactly the allowlisted fields with active member user ids', async () => {
    const { service, query } = queries([
      [{ id: missionId, status: 'ACCEPTED', request_id: requestId, campaign_id: campaignId, team_id: teamId, team_name: 'Đội A', work_cycle: '2' }],
      [{ user_id: leaderId, member_role: 'LEADER' }, { user_id: memberId, member_role: 'MEMBER' }],
    ]);

    expect(await service.internal(missionId)).toEqual({
      id: missionId,
      status: 'ACCEPTED',
      request_id: requestId,
      campaign_id: campaignId,
      team_id: teamId,
      team_name: 'Đội A',
      work_cycle: 2,
      member_user_ids: [leaderId, memberId],
      leader_user_ids: [leaderId],
    });
    expect(String(query.mock.calls[1]?.[0])).toContain('left_at IS NULL');
  });

  it('maps an unassigned request to a null campaign and an empty roster', async () => {
    const { service } = queries([
      [{ id: missionId, status: 'OFFERED', request_id: requestId, campaign_id: null, team_id: teamId, work_cycle: 1 }],
      [],
    ]);

    expect(await service.internal(missionId)).toMatchObject({ campaign_id: null, member_user_ids: [], leader_user_ids: [] });
  });

  it('answers NOT_FOUND for an unknown mission', async () => {
    const { service } = queries([[]]);

    await expect(service.internal(missionId)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('is served only behind the response service token guard', () => {
    const guards = Reflect.getMetadata('__guards__', MissionsController.prototype.internal) as unknown[];
    expect(guards).toEqual([ResponseServiceTokenGuard]);
  });
});
