import { jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import type { Request } from 'express';
import { MissionsQueriesService } from '../src/missions/missions-queries.service';
import { ReporterSessionService } from '../src/requests/reporter-session';

const userId = '00000000-0000-4000-8000-000000000002';
const ledTeamId = '00000000-0000-4000-8000-000000000003';
const memberTeamId = '00000000-0000-4000-8000-000000000004';
const missionId = '00000000-0000-4000-8000-000000000005';

const missionRow = (id: string, teamId: string, teamStatus = 'ACTIVE', teamReportingMode = 'APP') => ({
  id, request_id: '00000000-0000-4000-8000-000000000006', team_id: teamId, team_name: 'Đội A', work_cycle: 1,
  team_status: teamStatus, team_reporting_mode: teamReportingMode,
  status: 'ACCEPTED', mission_kind: 'RESCUE', version: '3', created_at: '2026-10-01T00:00:00.000Z',
  cursor_created_at: '2026-10-01T00:00:00.000000Z', campaign_id: null,
  approved_facts: { reporter_contact_phone: '0912345678', reporter_declared_danger: false },
});

function build(options: { grants?: unknown[]; memberRole?: 'LEADER' | 'MEMBER' | null; teams?: unknown[]; rows?: unknown[] }) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('FROM team_member WHERE user_id')) return options.teams ?? [];
    if (sql.includes('SELECT member_role FROM team_member')) return options.memberRole ? [{ member_role: options.memberRole }] : [];
    if (sql.includes('FROM mission_event') || sql.includes('FROM evidence_metadata')) return [];
    return options.rows ?? [];
  });
  const sessions = {
    require: jest.fn(async () => ({ userId, grants: options.grants ?? [] })),
  } as unknown as ReporterSessionService;
  const service = new MissionsQueriesService({ query } as unknown as DataSource, sessions, { offerOverdueMinutes: 10 } as never);
  return service;
}
const request = {} as Request;
const coordinatorGrant = {
  role_code: 'COORDINATOR', scope_type: 'SYSTEM', campaign_id: null,
};

describe('MissionsQueriesService can_manage_mission', () => {
  it('keeps assignment history and separately allowlists latest approved facts without leaking contacts', async () => {
    const row = { ...missionRow(missionId, memberTeamId), approved_facts: { people_affected: 12, description: 'Tình huống cũ' },
      current_approved_facts: { people_affected: 14, description: 'Đi vào phía sau nhà', reporter_contact_phone: 'private', reporter_name: 'private', reporter_declared_danger: true },
      situation_approved_at: '2026-11-28T03:00:00Z', situation_changed: true };
    const detail = await build({ memberRole: 'MEMBER', rows: [row] }).detail(missionId, request);
    expect(detail.people_affected).toBe(12);
    expect(detail.current_situation).toEqual({ people_affected: 14, children_count: null, elderly_count: null, description: 'Đi vào phía sau nhà', declared_danger: true,
      location: null, approved_at: '2026-11-28T03:00:00.000Z', changed_since_assignment: true });
    expect(JSON.stringify(detail)).not.toContain('private');
    await expect(build({ memberRole: null, rows: [row] }).detail(missionId, request)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('marks missions of led teams true and of member-only teams false, with contacts only for led teams', async () => {
    const service = build({
      teams: [{ team_id: ledTeamId, member_role: 'LEADER' }, { team_id: memberTeamId, member_role: 'MEMBER' }],
      rows: [missionRow('a', ledTeamId), missionRow('b', memberTeamId)],
    });

    const page = await service.mine({}, request) as { items: Array<Record<string, unknown>> };

    expect(page.items.map((item) => item.can_manage_mission)).toEqual([true, false]);
    expect(page.items[0]).toHaveProperty('reporter_contact_phone', '0912345678');
    expect(page.items[1]).not.toHaveProperty('reporter_contact_phone');
  });

  it('returns true in detail only for an active team leader', async () => {
    const detail = await build({ memberRole: 'LEADER', rows: [missionRow(missionId, ledTeamId)] }).detail(missionId, request);
    expect(detail.can_manage_mission).toBe(true);
    expect(detail).toHaveProperty('reporter_contact_phone');
  });

  it('returns false in detail for a plain member and hides contacts', async () => {
    const detail = await build({ memberRole: 'MEMBER', rows: [missionRow(missionId, memberTeamId)] }).detail(missionId, request);
    expect(detail.can_manage_mission).toBe(false);
    expect(detail).not.toHaveProperty('reporter_contact_phone');
  });

  it('returns false for scoped staff who see contacts but are not on the team', async () => {
    const detail = await build({ memberRole: null, grants: [coordinatorGrant], rows: [missionRow(missionId, ledTeamId)] })
      .detail(missionId, request);
    expect(detail.can_manage_mission).toBe(false);
    expect(detail).toHaveProperty('reporter_contact_phone', '0912345678');
  });

  it('does not offer leader commands when the team is inactive or coordinator-reported', async () => {
    const teams = [{ team_id: ledTeamId, member_role: 'LEADER' }];
    for (const row of [missionRow('a', ledTeamId, 'INACTIVE'), missionRow('b', ledTeamId, 'ACTIVE', 'COORDINATOR')]) {
      const page = await build({ teams, rows: [row] }).mine({}, request) as { items: Array<Record<string, unknown>> };
      const detail = await build({ memberRole: 'LEADER', rows: [row] }).detail(row.id, request);
      expect(page.items[0].can_manage_mission).toBe(false);
      expect(detail.can_manage_mission).toBe(false);
      expect(detail).toHaveProperty('reporter_contact_phone');
    }
  });
});
