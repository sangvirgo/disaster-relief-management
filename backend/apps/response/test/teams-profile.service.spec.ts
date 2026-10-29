import 'reflect-metadata';
import { describe, expect, it, jest } from '@jest/globals';
import type { DataSource, EntityManager } from 'typeorm';
import type { IdempotencyService } from '@c48/technical/idempotency/idempotency';
import type { ReporterSession, ReporterSessionService } from '../src/requests/reporter-session';
import type { TeamRow } from '../src/teams/teams.helpers';
import type { TeamsQueriesService } from '../src/teams/teams-queries.service';
import { TeamsProfileService } from '../src/teams/teams-profile.service';

const organizationId = '00000000-0000-4000-8000-000000000001';
const teamId = '00000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000003';
const idempotencyKey = '00000000-0000-4000-8000-000000000004';
const request = {} as never;

const team: TeamRow = {
  id: teamId,
  organization_id: organizationId,
  operating_region_code: 'NORTH',
  name: 'Đội cứu hộ',
  team_kind: 'VOLUNTEER',
  reporting_mode: 'APP',
  availability: 'UNAVAILABLE',
  status: 'ACTIVE',
  readiness_required: false,
  version: 4,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  skills: [],
  position_age_s: null,
  position_accuracy_m: null,
  position_source: null,
  longitude: null,
  latitude: null,
};

function fixture(activeMissions: unknown[] = [], currentTeam: TeamRow = team) {
  const dataSource = {} as DataSource;
  const managerQuery = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockImplementation(async (...args) => {
    if (String(args[0]).includes('FROM mission WHERE team_id=$1')) return activeMissions;
    return [[], 0];
  });
  const manager = { query: managerQuery } as unknown as EntityManager;
  const queries = {
    findTeam: jest.fn<(...args: unknown[]) => Promise<TeamRow | undefined>>()
      .mockResolvedValueOnce(currentTeam)
      .mockResolvedValueOnce(currentTeam)
      .mockResolvedValue(currentTeam),
  } as unknown as TeamsQueriesService;
  const sessions = {
    require: jest.fn<(...args: unknown[]) => Promise<ReporterSession>>().mockResolvedValue({
      userId,
      grants: [{ role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId }],
    }),
  } as unknown as ReporterSessionService;
  const idempotency = {
    execute: jest.fn(async (_source: DataSource, command: Parameters<IdempotencyService['execute']>[1]) => {
      const result = await command.execute(manager);
      return { status: result.status, value: result.value, replay: false };
    }),
  } as unknown as IdempotencyService;

  return {
    service: new TeamsProfileService(dataSource, idempotency, sessions, queries),
    managerQuery,
  };
}

describe('TeamsProfileService', () => {
  it('returns a version conflict when UPDATE RETURNING affects no team rows', async () => {
    const { service, managerQuery } = fixture();

    await expect(service.update(teamId, { expected_version: 4, name: 'Đội phản ứng nhanh' }, idempotencyKey, request))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409, details: { current_version: 4 } });

    expect(managerQuery).toHaveBeenCalledTimes(1);
  });

  it('does not mark a team unavailable while it has an offered mission', async () => {
    const { service, managerQuery } = fixture([{ status: 'OFFERED' }], { ...team, availability: 'AVAILABLE' });

    await expect(service.update(
      teamId, { expected_version: 4, availability: 'UNAVAILABLE' }, idempotencyKey, request,
    )).rejects.toMatchObject({ code: 'TEAM_BUSY', status: 409 });

    expect(managerQuery).toHaveBeenCalledTimes(1);
  expect(String(managerQuery.mock.calls[0]?.[0] ?? '')).toContain("FROM mission WHERE team_id=$1 AND status='OFFERED'");
  });
});
