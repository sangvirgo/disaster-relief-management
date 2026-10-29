import { jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import type { Request } from 'express';
import { MissionsQueriesService } from '../src/missions/missions-queries.service';
import { ReporterSessionService } from '../src/requests/reporter-session';

const organizationId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const ledTeamId = '00000000-0000-4000-8000-000000000003';
const memberTeamId = '00000000-0000-4000-8000-000000000004';
const missionId = '00000000-0000-4000-8000-000000000005';

const missionRow = (id: string, teamId: string) => ({
  id, request_id: '00000000-0000-4000-8000-000000000006', team_id: teamId, team_name: 'Đội A', work_cycle: 1,
  status: 'ACCEPTED', mission_kind: 'RESCUE', version: '3', created_at: '2026-10-01T00:00:00.000Z',
  cursor_created_at: '2026-10-01T00:00:00.000000Z', organization_id: organizationId, region_code: 'R1', campaign_id: null,
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
  role_code: 'COORDINATOR', scope_type: 'REGION', organization_id: organizationId, region_code: 'R1', campaign_id: null,
};

describe('MissionsQueriesService can_manage_mission', () => {
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
});
