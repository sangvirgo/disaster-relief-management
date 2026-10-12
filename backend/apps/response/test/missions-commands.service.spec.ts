import { jest } from '@jest/globals';
import { MissionsCommandsService } from '../src/missions/missions-commands.service';
import { CreateMissionDto } from '../src/missions/missions.dto';

const requestId = '00000000-0000-4000-8000-000000000001';
const teamId = '00000000-0000-4000-8000-000000000002';
const missionId = '00000000-0000-4000-8000-000000000003';
const coordinatorId = '00000000-0000-4000-8000-000000000004';
const organizationId = '00000000-0000-4000-8000-000000000005';
const revisionId = '00000000-0000-4000-8000-000000000006';

type TestQueryable = { query: (sql: string, parameters?: unknown[]) => Promise<unknown> };

interface MissionsCommandsTestSurface {
  offerInTransaction(
    manager: TestQueryable,
    requestId: string,
    dto: CreateMissionDto,
    session: unknown,
    suggestedTeamId: string | null,
  ): Promise<unknown>;
  recomputeRequest(
    manager: TestQueryable,
    request: { id: string; version: number; work_cycle: number; status: string },
    actorId: string,
    missionId: string,
  ): Promise<void>;
}

function service(): MissionsCommandsTestSurface {
  return new MissionsCommandsService({} as never, {} as never, {} as never, {} as never) as unknown as MissionsCommandsTestSurface;
}

describe('MissionsCommandsService UPDATE RETURNING handling', () => {
  it('stops the offer when PostgreSQL returns no updated request row', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT campaign_id FROM assistance_request')) return [{ campaign_id: null }];
      if (sql.includes('FROM assistance_request WHERE id=$1 FOR UPDATE')) return [{
        id: requestId, status: 'TRIAGED', version: 1, organization_id: organizationId, region_code: 'T8_REGION',
        campaign_id: null, incident_category_code: 'FLOOD', priority: 'P2', priority_basis: 'COMPLETE',
        work_cycle: 1, verification_revision: revisionId, attribution_locked_at: null, reporter_user_id: null,
      }];
      if (sql.includes('FROM rescue_team WHERE id=$1 FOR SHARE')) return [{
        id: teamId, organization_id: organizationId, operating_region_code: 'T8_REGION', reporting_mode: 'COORDINATOR',
        availability: 'AVAILABLE', status: 'ACTIVE', readiness_required: false, external_contact_note: 'Liên hệ điều phối',
      }];
      if (sql.includes('FROM incident_category_skill')) return [];
      if (sql.includes('FROM mission WHERE team_id=$1')) return [];
      if (sql.startsWith('INSERT INTO mission')) return [{
        id: missionId, request_id: requestId, team_id: teamId, work_cycle: 1, status: 'OFFERED', version: 1,
        created_at: '2026-10-12T00:00:00.000Z', suggested_team_id: teamId,
      }];
      if (sql.startsWith('SELECT status FROM mission')) return [{ status: 'OFFERED' }];
      if (sql.startsWith('UPDATE assistance_request')) return [[], 0];
      return [];
    });
    const subject = service();
    const manager = { query };

    await expect(subject.offerInTransaction(
      manager,
      requestId,
      { expected_version: 1, team_id: teamId } as CreateMissionDto,
      { userId: coordinatorId, grants: [{ role_code: 'COORDINATOR', scope_type: 'REGION', organization_id: organizationId, region_code: 'T8_REGION' }] },
      teamId,
    )).rejects.toMatchObject({ code: 'VERSION_CONFLICT', details: { current_version: 1 } });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO request_event'))).toBe(false);
  });

  it('does not append progress when PostgreSQL returns no updated request row', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT status FROM mission')) return [{ status: 'ACCEPTED' }];
      if (sql.startsWith('UPDATE assistance_request')) return [[], 0];
      return [];
    });

    await expect(service().recomputeRequest(
      { query }, { id: requestId, version: 2, work_cycle: 1, status: 'DISPATCHED' }, coordinatorId, missionId,
    )).rejects.toMatchObject({ code: 'VERSION_CONFLICT', details: { current_version: 2 } });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO request_event'))).toBe(false);
  });
});
