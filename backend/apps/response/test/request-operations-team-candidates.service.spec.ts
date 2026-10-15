import { jest } from '@jest/globals';
import { RequestOperationsTeamCandidatesService } from '../src/operations/request-operations.team-candidates.service';

describe('RequestOperationsTeamCandidatesService', () => {
  it('returns no suggestions without querying candidates when the request has no region', async () => {
    const session = { userId: 'coordinator-1', grants: [] };
    const dataSource = { query: jest.fn() };
    const sessions = { require: jest.fn().mockResolvedValue(session) };
    const persistence = {
      staffRequest: jest.fn().mockResolvedValue({
        priority: 'P1', region_code: null, organization_id: 'organization-1',
      }),
    };
    const service = new RequestOperationsTeamCandidatesService(
      dataSource as never,
      sessions as never,
      persistence as never,
    );

    await expect(service.list('request-1', {} as never, {} as never)).resolves.toEqual({
      parameters: {
        radius_m: 10_000,
        position_max_age_s: 1_800,
        priority: 'P1',
        distance_tolerance_m: 0,
      },
      items: [],
      unknown_position: [],
    });
    expect(sessions.require).toHaveBeenCalledTimes(1);
    expect(persistence.staffRequest).toHaveBeenCalledWith(dataSource, 'request-1', session, 'MISSION_ASSIGN');
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
