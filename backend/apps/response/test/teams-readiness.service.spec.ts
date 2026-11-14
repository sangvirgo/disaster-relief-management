import 'reflect-metadata';
import { describe, expect, it, jest } from '@jest/globals';
import type { DataSource, EntityManager } from 'typeorm';
import type { IdempotencyService } from '@c48/technical/idempotency/idempotency';
import type { ReporterSession, ReporterSessionService } from '../src/requests/reporter-session';
import type { TeamsQueriesService } from '../src/teams/teams-queries.service';
import type { TeamRow } from '../src/teams/teams.helpers';
import type { ConfirmTeamReadinessDto } from '../src/teams/teams.dto';
import { TeamsProfileService } from '../src/teams/teams-profile.service';

const teamId = '00000000-0000-4000-8000-000000000001';
const organizationId = '00000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000003';
const dto: ConfirmTeamReadinessDto = {
  expected_version: 6, confirmation_basis: 'SELF', occurred_at: '2026-11-08T01:00:00.000Z',
};

function fixture(options: { leader?: boolean; manager?: boolean; active?: boolean; validTime?: boolean;
  missing?: boolean; replay?: boolean; team?: Partial<TeamRow> } = {}) {
  let row = { id: teamId, organization_id: organizationId,
    name: 'Đội kiểm thử', team_kind: 'VOLUNTEER', reporting_mode: 'APP', status: 'ACTIVE',
    availability: 'UNAVAILABLE', readiness_required: true, version: 6, skills: [], position_source: null,
    ...options.team } as TeamRow;
  const query = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockImplementation(async (sql) => {
    const text = String(sql);
    if (text.includes('FROM team_member')) return options.leader === false ? [] : [{ exists: 1 }];
    if (text.includes('FROM mission WHERE')) return options.active ? [{ exists: 1 }] : [];
    if (text.includes('AS valid')) return [{ valid: options.validTime !== false }];
    if (text.includes('UPDATE rescue_team')) {
      row = { ...row, availability: 'AVAILABLE', readiness_required: false, version: row.version + 1 };
      return [[{ id: teamId }], 1];
    }
    return [];
  });
  const manager = { query } as unknown as EntityManager;
  const findTeam = jest.fn<(...args: unknown[]) => Promise<TeamRow | undefined>>()
    .mockImplementation(async () => options.missing ? undefined : { ...row });
  const sessions = { require: jest.fn(async () => ({ userId, grants: options.manager
    ? [{ role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId }] : [],
  } as ReporterSession)) } as unknown as ReporterSessionService;
  const idempotency = { execute: jest.fn(async (_: DataSource, command: Parameters<IdempotencyService['execute']>[1]) => {
    if (options.replay) return { value: await command.replay!(manager, { type: 'rescue_team', id: teamId }), replay: true, status: 200 };
    const result = await command.execute(manager);
    return { ...result, replay: false };
  }) } as unknown as IdempotencyService;
  return { query, findTeam, service: new TeamsProfileService({} as DataSource, idempotency, sessions,
    { findTeam } as unknown as TeamsQueriesService) };
}

describe('explicit team readiness acknowledgement', () => {
  it('atomically clears the latch, sets AVAILABLE and audits actor/source/person/time for the leader', async () => {
    const { service, query, findTeam } = fixture();
    const result = await service.ready(teamId, dto, 'key', {} as never);
    expect(result.value).toMatchObject({ readiness_required: false, availability: 'AVAILABLE', version: 7 });
    expect(findTeam.mock.calls[0]).toEqual([expect.anything(), teamId, true]);
    const audit = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO audit_log'));
    expect(audit?.[1]).toEqual([userId, 'TEAM_READINESS_CONFIRMED', teamId, expect.any(String), expect.any(String)]);
    expect(JSON.parse((audit?.[1] as string[])[4]!)).toMatchObject({ confirmation_basis: 'SELF', reported_by: userId,
      occurred_at: dto.occurred_at, readiness_required: false });
  });

  it('allows a scoped coordinator to record a named field confirmation for an accountless team', async () => {
    const { service } = fixture({ manager: true, leader: false, team: { reporting_mode: 'COORDINATOR' } });
    await expect(service.ready(teamId, { ...dto, confirmation_basis: 'PHONE', reported_by: '  Đội trưởng demo  ' },
      'key', {} as never)).resolves.toMatchObject({ value: { readiness_required: false, version: 7 } });
  });

  it.each([
    ['member cannot self-confirm', { leader: false }, dto, 'FORBIDDEN'],
    ['wrong-scope staff cannot confirm', { leader: false }, { ...dto, confirmation_basis: 'PHONE', reported_by: 'Đội demo' }, 'FORBIDDEN'],
    ['accountless team cannot use SELF', { manager: true, team: { reporting_mode: 'COORDINATOR' } }, dto, 'FORBIDDEN'],
    ['staff must name the reporting person', { manager: true }, { ...dto, confirmation_basis: 'PHONE', reported_by: '  ' }, 'VALIDATION_FAILED'],
    ['old version cannot clear a newer latch', { team: { version: 7 } }, dto, 'VERSION_CONFLICT'],
    ['offered or active work blocks readiness', { active: true }, dto, 'TEAM_BUSY'],
    ['inactive team remains inactive', { team: { status: 'INACTIVE' } }, dto, 'TEAM_NOT_ELIGIBLE'],
    ['old or future field report is rejected', { validTime: false }, dto, 'VALIDATION_FAILED'],
    ['missing team is not created', { missing: true }, dto, 'NOT_FOUND'],
  ] as const)('%s', async (_name, options, input, code) => {
    const { service, query } = fixture(options);
    await expect(service.ready(teamId, input, 'key', {} as never)).rejects.toMatchObject({ code });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE rescue_team'))).toBe(false);
  });

  it('replay reads current state without clearing a newer latch or incrementing the version', async () => {
    const { service, query } = fixture({ replay: true, team: { version: 9 } });
    await expect(service.ready(teamId, dto, 'key', {} as never)).resolves.toMatchObject({
      replay: true, value: { readiness_required: true, availability: 'UNAVAILABLE', version: 9 },
    });
    expect(query.mock.calls.some(([sql]) => String(sql).includes('UPDATE rescue_team'))).toBe(false);
  });

  it('retains the generic PATCH readiness guard', async () => {
    const { service } = fixture({ manager: true });
    await expect(service.update(teamId, { expected_version: 6, availability: 'AVAILABLE' }, 'key', {} as never))
      .rejects.toMatchObject({ code: 'TEAM_NOT_ELIGIBLE' });
  });
});
