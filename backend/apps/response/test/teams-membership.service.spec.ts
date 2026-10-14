import 'reflect-metadata';
import { describe, expect, it, jest } from '@jest/globals';
import type { DataSource, EntityManager } from 'typeorm';
import type { IdempotentCommand, IdempotencyService } from '../../../packages/technical/src/idempotency/idempotency';
import type { ReporterSession, ReporterSessionService } from '../src/requests/reporter-session';
import type { TeamRow } from '../src/teams/teams.helpers';
import type { TeamsQueriesService } from '../src/teams/teams-queries.service';
import { TeamsMembershipService } from '../src/teams/teams-membership.service';

const organizationId = '00000000-0000-4000-8000-000000000001';
const teamId = '00000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000003';
const actorId = '00000000-0000-4000-8000-000000000004';
const idempotencyKey = '00000000-0000-4000-8000-000000000005';
const request = {} as never;
const joinedAt = new Date('2026-10-14T01:02:03.000Z');

const initialTeam: TeamRow = {
  id: teamId,
  organization_id: organizationId,
  operating_region_code: 'NORTH',
  name: 'Đội cứu hộ',
  team_kind: 'VOLUNTEER',
  reporting_mode: 'APP',
  availability: 'AVAILABLE',
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

type Member = { member_role: 'LEADER' | 'MEMBER'; left_at: Date | null };

function fixture(options: { members?: Record<string, Member>; activeTeamId?: string; grants?: ReporterSession['grants'] } = {}) {
  const state = {
    members: new Map(Object.entries(options.members ?? {})),
    activeTeamId: options.activeTeamId ?? null as string | null,
    joinedAt: null as Date | null,
    auditActions: [] as string[],
    auditEvents: [] as Array<{ entity_type: string; entity_id: string; action: string; after_state: Record<string, unknown>; created_at: Date }>,
    version: initialTeam.version,
  };
  let auditSequence = 0;
  const managerQuery = jest.fn(async (sql: string, parameters: unknown[] = []) => {
    if (sql.includes('SELECT team_id FROM team_member') && sql.includes('left_at IS NULL')) {
      return state.activeTeamId ? [{ team_id: state.activeTeamId }] : [];
    }
    if (sql.startsWith('SELECT 1 FROM team_member')) return [];
    if (sql.includes('SELECT member_role,left_at FROM team_member') || sql.includes('SELECT user_id,member_role,left_at FROM team_member') || sql.includes('SELECT member_role FROM team_member')) {
      const member = state.members.get(String(parameters[1]));
      return member ? [{ user_id: parameters[1], ...member }] : [];
    }
    if (sql.includes('SELECT created_at FROM audit_log')) {
      return state.joinedAt ? [{ created_at: state.joinedAt }] : [];
    }
    if (sql.includes('SELECT after_state,created_at FROM audit_log')) {
      const event = [...state.auditEvents].reverse().find(({ entity_type, entity_id, after_state }) =>
        entity_type === 'team_member' && entity_id === parameters[0] && after_state.idempotency_key === parameters[1]);
      return event ? [{ after_state: event.after_state, created_at: event.created_at }] : [];
    }
    if (sql.includes('SELECT after_state FROM audit_log')) {
      const event = [...state.auditEvents].reverse().find(({ entity_type, entity_id, after_state }) =>
        entity_type === 'rescue_team' && entity_id === parameters[0] && after_state.idempotency_key === parameters[1]);
      return event ? [{ after_state: event.after_state }] : [];
    }
    if (sql.startsWith('INSERT INTO team_member')) {
      state.members.set(String(parameters[1]), { member_role: 'MEMBER', left_at: null });
      state.activeTeamId = teamId;
      return [{ member_role: 'MEMBER' }];
    }
    if (sql.startsWith('UPDATE team_member SET member_role=') && sql.includes('left_at=NULL')) {
      state.members.set(String(parameters[1]), { member_role: 'MEMBER', left_at: null });
      state.activeTeamId = teamId;
      return [[{ member_role: 'MEMBER' }], 1];
    }
    if (sql.startsWith('UPDATE team_member SET left_at=')) {
      const member = state.members.get(String(parameters[1]));
      if (!member) return [];
      state.members.set(String(parameters[1]), { ...member, left_at: joinedAt });
      state.activeTeamId = null;
      return [[{ left_at: joinedAt }], 1];
    }
    if (sql.startsWith('INSERT INTO audit_log')) {
      const action = String(parameters[1]);
      state.auditActions.push(action);
      const memberAudit = sql.includes("VALUES ($1,$2,'team_member'");
      const event = {
        entity_type: memberAudit ? 'team_member' : String(parameters[2]),
        entity_id: String(memberAudit ? parameters[2] : parameters[3]),
        action,
        after_state: JSON.parse(String(parameters[memberAudit ? 4 : 5])) as Record<string, unknown>,
        created_at: new Date(joinedAt.getTime() + auditSequence * 1_000),
      };
      auditSequence += 1;
      state.auditEvents.push(event);
      if (action === 'TEAM_MEMBER_ADDED') state.joinedAt = event.created_at;
      return [{ created_at: event.created_at }];
    }
    if (sql.includes('SELECT user_id FROM team_member') && sql.includes("member_role='LEADER'")) {
      const leaders = [...state.members.entries()].filter(([, member]) => member.member_role === 'LEADER' && member.left_at === null);
      return leaders.map(([id]) => ({ user_id: id }));
    }
    if (sql.startsWith('UPDATE team_member SET member_role=')) {
      const user = String(parameters[1]);
      const member = state.members.get(user);
      if (!member) return [];
      state.members.set(user, { ...member, member_role: sql.includes("member_role='LEADER'") ? 'LEADER' : 'MEMBER' });
      return [{ user_id: user }];
    }
    if (sql.startsWith('UPDATE rescue_team')) {
      state.version += 1;
      return [[{ version: state.version }], 1];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
  const manager = { query: managerQuery } as unknown as EntityManager;
  const queries = {
    findTeam: jest.fn(async () => ({ ...initialTeam, version: state.version })),
  } as unknown as TeamsQueriesService;
  const sessions = {
    require: jest.fn(async () => ({
      userId: actorId,
      grants: options.grants ?? [{ role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId }],
    })),
    activeUserCheck: jest.fn(async () => ({ active: true as const })),
    teamLeaderEligibility: jest.fn(async () => ({ eligible: true as const })),
  } as unknown as ReporterSessionService;
  const records = new Map<string, { hash: string; status: number; resource: { type: string; id: string } | null }>();
  const idempotency = {
    async execute<T>(_source: DataSource, command: IdempotentCommand<T>) {
      const recordKey = `${command.scopeKey}:${command.command}:${command.key}`;
      const previous = records.get(recordKey);
      if (previous) {
        if (previous.hash !== command.requestHash) throw new Error('IDEMPOTENCY_KEY_REUSED');
        return { status: previous.status, value: await command.replay(manager, previous.resource, previous.status), replay: true };
      }
      const outcome = await command.execute(manager);
      records.set(recordKey, { hash: command.requestHash, status: outcome.status, resource: outcome.resource });
      return { status: outcome.status, value: outcome.value, replay: false };
    },
  } as unknown as IdempotencyService;
  const dataSource = { query: managerQuery } as unknown as DataSource;
  const service = new TeamsMembershipService(dataSource, idempotency, sessions, queries);
  return { service, managerQuery, sessions, state, records };
}

describe('TeamsMembershipService', () => {
  it('adds an active account as a MEMBER and returns the persisted audit timestamp', async () => {
    const { service, state } = fixture();

    await expect(service.addMember(teamId, { user_id: userId }, idempotencyKey, request)).resolves.toEqual({
      status: 201,
      replay: false,
      value: { team_id: teamId, user_id: userId, member_role: 'MEMBER', joined_at: joinedAt.toISOString() },
    });
    expect(state.members.get(userId)).toEqual({ member_role: 'MEMBER', left_at: null });
    expect(state.auditActions).toContain('TEAM_MEMBER_ADDED');
  });

  it.each([
    [{ active: false, reason: 'USER_NOT_FOUND' }, 'NOT_FOUND', 404],
    [{ active: false, reason: 'USER_INACTIVE' }, 'STATE_TRANSITION_INVALID', 409],
  ] as const)('maps Identity member eligibility %s to the stable API error', async (result, code, status) => {
    const { service, sessions, managerQuery } = fixture();
    (sessions.activeUserCheck as jest.Mock).mockResolvedValue(result);

    await expect(service.addMember(teamId, { user_id: userId }, idempotencyKey, request))
      .rejects.toMatchObject({ code, status });
    expect(managerQuery).not.toHaveBeenCalled();
  });

  it('denies a caller without leader or scoped team-management access', async () => {
    const { service, managerQuery } = fixture({ grants: [] });

    await expect(service.addMember(teamId, { user_id: userId }, idempotencyKey, request))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(managerQuery.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO team_member'))).toBe(false);
  });

  it('returns USER_IN_OTHER_TEAM when the account already has another active team', async () => {
    const { service } = fixture({ activeTeamId: '00000000-0000-4000-8000-000000000099' });

    await expect(service.addMember(teamId, { user_id: userId }, idempotencyKey, request))
      .rejects.toMatchObject({ code: 'USER_IN_OTHER_TEAM', status: 409 });
  });

  it('reactivates a historical membership row as MEMBER without adding a duplicate row', async () => {
    const { service, managerQuery, state } = fixture({
      members: { [userId]: { member_role: 'MEMBER', left_at: new Date('2026-09-01T00:00:00.000Z') } },
    });

    await expect(service.addMember(teamId, { user_id: userId }, idempotencyKey, request)).resolves.toMatchObject({
      status: 201,
      value: { team_id: teamId, user_id: userId, member_role: 'MEMBER', joined_at: joinedAt.toISOString() },
    });
    expect(managerQuery.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT INTO team_member'))).toHaveLength(0);
    expect(state.members.get(userId)).toEqual({ member_role: 'MEMBER', left_at: null });
  });

  it('replays an add confirmation with its original role and joined timestamp', async () => {
    const { service, state } = fixture({
      members: { [userId]: { member_role: 'LEADER', left_at: null } },
    });

    const first = await service.addMember(teamId, { user_id: userId }, idempotencyKey, request);
    state.members.set(userId, { member_role: 'MEMBER', left_at: joinedAt });
    const replay = await service.addMember(teamId, { user_id: userId }, idempotencyKey, request);

    expect(first.value).toEqual({
      team_id: teamId, user_id: userId, member_role: 'LEADER', joined_at: initialTeam.created_at.toISOString(),
    });
    expect(replay).toEqual({ status: 201, replay: true, value: first.value });
    expect(state.auditActions).toContain('TEAM_MEMBER_ADD_CONFIRMED');
  });

  it('replays an add snapshot without rechecking whether the account is still active', async () => {
    const { service, sessions } = fixture();
    const first = await service.addMember(teamId, { user_id: userId }, idempotencyKey, request);
    (sessions.activeUserCheck as jest.Mock).mockResolvedValue({ active: false, reason: 'USER_INACTIVE' });

    await expect(service.addMember(teamId, { user_id: userId }, idempotencyKey, request)).resolves.toEqual({
      status: 201, replay: true, value: first.value,
    });
    expect(sessions.activeUserCheck).toHaveBeenCalledTimes(1);
  });

  it('replays the original add result after the member is removed and rejoins', async () => {
    const { service, managerQuery } = fixture();

    const first = await service.addMember(teamId, { user_id: userId }, idempotencyKey, request);
    await service.removeMember(teamId, userId, '00000000-0000-4000-8000-000000000007', request);
    const rejoined = await service.addMember(teamId, { user_id: userId }, '00000000-0000-4000-8000-000000000008', request);
    const second = await service.addMember(teamId, { user_id: userId }, idempotencyKey, request);

    expect(first.value).toEqual(second.value);
    expect(second.replay).toBe(true);
    expect(second.value.joined_at).not.toBe(rejoined.value.joined_at);
    expect(second.status).toBe(201);
    expect(second.value).toMatchObject({ team_id: teamId, user_id: userId, member_role: 'MEMBER' });
    expect(managerQuery.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT INTO team_member'))).toHaveLength(1);
  });

  it('removes a non-leader by setting left_at and retaining the row', async () => {
    const { service, state, managerQuery } = fixture({
      members: { [userId]: { member_role: 'MEMBER', left_at: null } },
    });

    await expect(service.removeMember(teamId, userId, idempotencyKey, request)).resolves.toEqual({
      status: 204, replay: false, value: null,
    });
    expect(state.members.get(userId)?.left_at).toEqual(joinedAt);
    expect(managerQuery.mock.calls.some(([sql]) => String(sql).startsWith('DELETE FROM team_member'))).toBe(false);
    expect(state.auditActions).toContain('TEAM_MEMBER_REMOVED');
  });

  it('prevents removal of the active leader', async () => {
    const { service, managerQuery } = fixture({
      members: { [userId]: { member_role: 'LEADER', left_at: null } },
    });

    await expect(service.removeMember(teamId, userId, idempotencyKey, request))
      .rejects.toMatchObject({ code: 'LEADER_REQUIRED', status: 409 });
    expect(managerQuery.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE team_member SET left_at='))).toBe(false);
  });

  it('transfers leadership under the expected team version and updates both memberships before versioning', async () => {
    const oldLeader = '00000000-0000-4000-8000-000000000006';
    const { service, managerQuery, state } = fixture({
      members: {
        [oldLeader]: { member_role: 'LEADER', left_at: null },
        [userId]: { member_role: 'MEMBER', left_at: null },
      },
    });

    await expect(service.transferLeader(teamId, { user_id: userId, expected_version: 4 }, idempotencyKey, request)).resolves.toEqual({
      status: 200, replay: false, value: { team_id: teamId, leader_user_id: userId, version: 5 },
    });
    expect(state.members.get(oldLeader)?.member_role).toBe('MEMBER');
    expect(state.members.get(userId)?.member_role).toBe('LEADER');
    const sql = managerQuery.mock.calls.map(([statement]) => String(statement));
    expect(sql.findIndex((statement) => statement.startsWith('UPDATE team_member SET member_role=')))
      .toBeLessThan(sql.findIndex((statement) => statement.startsWith('UPDATE rescue_team')));
  });

  it('replays the original leader and version after a later transfer', async () => {
    const oldLeader = '00000000-0000-4000-8000-000000000006';
    const nextLeader = '00000000-0000-4000-8000-000000000009';
    const { service, state } = fixture({
      members: {
        [oldLeader]: { member_role: 'LEADER', left_at: null },
        [userId]: { member_role: 'MEMBER', left_at: null },
        [nextLeader]: { member_role: 'MEMBER', left_at: null },
      },
    });

    const firstTransfer = await service.transferLeader(teamId, { user_id: userId, expected_version: 4 }, idempotencyKey, request);
    expect(state.auditEvents).toContainEqual(expect.objectContaining({
      entity_type: 'rescue_team', entity_id: teamId, action: 'TEAM_LEADER_TRANSFERRED',
      after_state: expect.objectContaining({ idempotency_key: idempotencyKey, leader_user_id: userId, version: 5 }),
    }));
    await service.transferLeader(teamId, { user_id: nextLeader, expected_version: 5 }, '00000000-0000-4000-8000-000000000010', request);
    const replay = await service.transferLeader(teamId, { user_id: userId, expected_version: 4 }, idempotencyKey, request);

    expect(firstTransfer.value).toEqual({ team_id: teamId, leader_user_id: userId, version: 5 });
    expect(replay).toEqual({ status: 200, replay: true, value: firstTransfer.value });
    expect(state.members.get(nextLeader)?.member_role).toBe('LEADER');
  });

  it('replays a leader-transfer snapshot without rechecking target eligibility', async () => {
    const oldLeader = '00000000-0000-4000-8000-000000000006';
    const { service, sessions } = fixture({
      members: {
        [oldLeader]: { member_role: 'LEADER', left_at: null },
        [userId]: { member_role: 'MEMBER', left_at: null },
      },
    });
    const first = await service.transferLeader(
      teamId, { user_id: userId, expected_version: 4 }, idempotencyKey, request,
    );
    (sessions.teamLeaderEligibility as jest.Mock).mockResolvedValue({ eligible: false, reason: 'USER_INACTIVE' });

    await expect(service.transferLeader(
      teamId, { user_id: userId, expected_version: 4 }, idempotencyKey, request,
    )).resolves.toEqual({ status: 200, replay: true, value: first.value });
    expect(sessions.teamLeaderEligibility).toHaveBeenCalledTimes(1);
  });

  it('preserves a no-op leader transfer result after the leader changes later', async () => {
    const nextLeader = '00000000-0000-4000-8000-000000000009';
    const { service, state } = fixture({
      members: {
        [userId]: { member_role: 'LEADER', left_at: null },
        [nextLeader]: { member_role: 'MEMBER', left_at: null },
      },
    });

    const firstTransfer = await service.transferLeader(teamId, { user_id: userId, expected_version: 4 }, idempotencyKey, request);
    await service.transferLeader(teamId, { user_id: nextLeader, expected_version: 4 }, '00000000-0000-4000-8000-000000000010', request);
    const replay = await service.transferLeader(teamId, { user_id: userId, expected_version: 4 }, idempotencyKey, request);

    expect(firstTransfer.value).toEqual({ team_id: teamId, leader_user_id: userId, version: 4 });
    expect(replay).toEqual({ status: 200, replay: true, value: firstTransfer.value });
    expect(state.members.get(nextLeader)?.member_role).toBe('LEADER');
    expect(state.auditActions).toContain('TEAM_LEADER_TRANSFER_CONFIRMED');
  });

  it.each([
    ['USER_NOT_FOUND', 'NOT_FOUND'],
    ['USER_INACTIVE', 'STATE_TRANSITION_INVALID'],
    ['MEMBERSHIP_REQUIRED', 'STATE_TRANSITION_INVALID'],
    ['VOLUNTEER_GRANT_REQUIRED', 'STATE_TRANSITION_INVALID'],
  ] as const)('maps Identity leader eligibility reason %s to %s', async (reason, code) => {
    const oldLeader = '00000000-0000-4000-8000-000000000006';
    const { service, sessions, managerQuery } = fixture({
      members: {
        [oldLeader]: { member_role: 'LEADER', left_at: null },
        [userId]: { member_role: 'MEMBER', left_at: null },
      },
    });
    (sessions.teamLeaderEligibility as jest.Mock).mockResolvedValue({ eligible: false, reason });

    await expect(service.transferLeader(teamId, { user_id: userId, expected_version: 4 }, idempotencyKey, request))
      .rejects.toMatchObject({ code, status: code === 'NOT_FOUND' ? 404 : 409 });
    expect(managerQuery).not.toHaveBeenCalled();
    expect(sessions.teamLeaderEligibility).toHaveBeenCalledWith(userId, organizationId);
  });

  it('rejects a stale team version without changing either membership', async () => {
    const oldLeader = '00000000-0000-4000-8000-000000000006';
    const { service, managerQuery } = fixture({
      members: {
        [oldLeader]: { member_role: 'LEADER', left_at: null },
        [userId]: { member_role: 'MEMBER', left_at: null },
      },
    });

    await expect(service.transferLeader(teamId, { user_id: userId, expected_version: 3 }, idempotencyKey, request))
      .rejects.toMatchObject({ code: 'VERSION_CONFLICT', status: 409 });
    expect(managerQuery).not.toHaveBeenCalled();
  });

  it('requires coordinator-level TEAM_MANAGE_ANY for leadership transfer', async () => {
    const { service, managerQuery } = fixture({
      grants: [{ role_code: 'VOLUNTEER', scope_type: 'SYSTEM', organization_id: null }],
    });

    await expect(service.transferLeader(teamId, { user_id: userId, expected_version: 4 }, idempotencyKey, request))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(managerQuery).not.toHaveBeenCalled();
  });
});
