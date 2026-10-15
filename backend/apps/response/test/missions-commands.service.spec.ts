import { jest } from '@jest/globals';
import { MissionsCommandsService } from '../src/missions/missions-commands.service';
import { CreateMissionDto } from '../src/missions/missions.dto';

const requestId = '00000000-0000-4000-8000-000000000001';
const teamId = '00000000-0000-4000-8000-000000000002';
const missionId = '00000000-0000-4000-8000-000000000003';
const coordinatorId = '00000000-0000-4000-8000-000000000004';
const organizationId = '00000000-0000-4000-8000-000000000005';
const revisionId = '00000000-0000-4000-8000-000000000006';
const campaignId = '00000000-0000-4000-8000-000000000007';

type TestQueryable = { query: (sql: string, parameters?: unknown[]) => Promise<unknown> };

interface MissionsCommandsTestSurface {
  offerInTransaction(
    manager: TestQueryable,
    requestId: string,
    dto: CreateMissionDto,
    session: unknown,
    suggestedTeamId: string | null,
  ): Promise<unknown>;
  changeInTransaction(
    manager: TestQueryable,
    missionId: string,
    requestId: string,
    teamId: string,
    expectedVersion: number,
    session: unknown,
    change: { command: string; target: string; mode: string; reason?: string },
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

  it('does not rewrite request progress when an active mission keeps it IN_PROGRESS', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT status FROM mission')) return [{ status: 'EN_ROUTE' }];
      return [];
    });

    await service().recomputeRequest(
      { query }, { id: requestId, version: 4, work_cycle: 1, status: 'IN_PROGRESS' }, coordinatorId, missionId,
    );

    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE assistance_request'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO request_event'))).toBe(false);
  });

  it('keeps a RESOLVING request unchanged during mission-progress recomputation', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT status FROM mission')) return [];
      return [];
    });

    await service().recomputeRequest(
      { query }, { id: requestId, version: 5, work_cycle: 1, status: 'RESOLVING' }, coordinatorId, missionId,
    );

    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE assistance_request'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO request_event'))).toBe(false);
  });

  it('rejects a mission transition after the request enters RESOLVING', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql === 'SELECT campaign_id FROM assistance_request WHERE id=$1') return [{ campaign_id: null }];
      if (sql.includes('FROM assistance_request WHERE id=$1 FOR UPDATE')) return [{
        id: requestId, status: 'RESOLVING', version: 5, organization_id: organizationId, region_code: 'T8_REGION',
        campaign_id: null, incident_category_code: 'FLOOD', priority: 'P2', priority_basis: 'COMPLETE',
        work_cycle: 1, verification_revision: revisionId, attribution_locked_at: null, reporter_user_id: null,
      }];
      return [];
    });

    await expect(service().changeInTransaction(
      { query }, missionId, requestId, teamId, 3, { userId: coordinatorId, grants: [] },
      { command: 'transition', target: 'EN_ROUTE', mode: 'LEADER' },
    )).rejects.toMatchObject({ code: 'STATE_TRANSITION_INVALID', status: 409 });
    expect(query.mock.calls.some(([sql]) => sql.startsWith('UPDATE mission'))).toBe(false);
  });
});

describe('MissionsCommandsService campaign mission-offer eligibility', () => {
  it('rejects a first mission offer when the request has no region', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT campaign_id FROM assistance_request')) return [{ campaign_id: null }];
      if (sql.includes('FROM assistance_request WHERE id=$1 FOR UPDATE')) return [{
        id: requestId, status: 'TRIAGED', version: 1, organization_id: organizationId, region_code: null,
        campaign_id: null, incident_category_code: 'FLOOD', priority: 'P2', priority_basis: 'COMPLETE',
        work_cycle: 1, verification_revision: revisionId, attribution_locked_at: null, reporter_user_id: null,
      }];
      return [];
    });

    await expect(service().offerInTransaction(
      { query }, requestId, { expected_version: 1, team_id: teamId } as CreateMissionDto,
      { userId: coordinatorId, grants: [{
        role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId,
      }] }, null,
    )).rejects.toMatchObject({ code: 'REGION_REQUIRED', status: 409 });
    expect(query.mock.calls.some(([sql]) => sql.includes('FROM rescue_team'))).toBe(false);
  });

  async function offerWithCampaignStatus(status: string) {
    const query = jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT campaign_id FROM assistance_request')) return [{ campaign_id: campaignId }];
      if (sql.startsWith('SELECT status FROM campaign')) return [{ status }];
      return [];
    });

    await expect(service().offerInTransaction(
      { query }, requestId, { expected_version: 1, team_id: teamId } as CreateMissionDto,
      { userId: coordinatorId, grants: [] }, null,
    )).rejects.toMatchObject({ code: status === 'PAUSED' ? 'CAMPAIGN_PAUSED' : 'CAMPAIGN_NOT_ACTIVE' });

    return query;
  }

  it('keeps the paused campaign error and checks it before locking the request', async () => {
    const query = await offerWithCampaignStatus('PAUSED');

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'SELECT campaign_id FROM assistance_request WHERE id=$1',
      'SELECT status FROM campaign WHERE id=$1 FOR SHARE',
    ]);
  });

  it.each(['DRAFT', 'CLOSED'])('rejects %s campaigns before request, team, or mission queries', async (status) => {
    const query = await offerWithCampaignStatus(status);

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'SELECT campaign_id FROM assistance_request WHERE id=$1',
      'SELECT status FROM campaign WHERE id=$1 FOR SHARE',
    ]);
  });
});

describe('MissionsCommandsService paused campaign mission changes', () => {
  function changeWithPausedCampaign(command: string, target: string, mode: string) {
    const query = jest.fn(async (sql: string) => {
      if (sql === 'SELECT campaign_id FROM assistance_request WHERE id=$1') return [{ campaign_id: campaignId }];
      if (sql === 'SELECT status FROM campaign WHERE id=$1 FOR SHARE') return [{ status: 'PAUSED' }];
      if (sql.includes('FROM assistance_request WHERE id=$1 FOR UPDATE')) return [];
      return [];
    });

    const promise = service().changeInTransaction(
      { query }, missionId, requestId, teamId, 1,
      { userId: coordinatorId, grants: [] }, { command, target, mode, reason: 'Lý do kiểm thử.' },
    );
    return { promise, query };
  }

  it('rejects accepting an existing offer after its campaign is paused', async () => {
    const { promise, query } = changeWithPausedCampaign('accept', 'ACCEPTED', 'LEADER');

    await expect(promise).rejects.toMatchObject({ code: 'CAMPAIGN_PAUSED', status: 409 });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'SELECT campaign_id FROM assistance_request WHERE id=$1',
      'SELECT status FROM campaign WHERE id=$1 FOR SHARE',
    ]);
  });

  it.each([
    ['decline', 'DECLINED', 'LEADER'],
    ['cancel', 'CANCELLED', 'ASSIGN'],
  ])('still reaches the request lock for %s while its campaign is paused', async (command, target, mode) => {
    const { promise, query } = changeWithPausedCampaign(command, target, mode);

    await expect(promise).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      'SELECT campaign_id FROM assistance_request WHERE id=$1',
      'SELECT status FROM campaign WHERE id=$1 FOR SHARE',
      expect.stringContaining('FROM assistance_request WHERE id=$1 FOR UPDATE'),
    ]);
  });
});
