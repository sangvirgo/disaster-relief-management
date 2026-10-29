import 'reflect-metadata';
import { describe, expect, it, jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import type { Request } from 'express';
import { TeamsPositionService } from '../src/teams/teams-position.service';
import type { ReporterSessionService } from '../src/requests/reporter-session';
import type { SetTeamPositionDto } from '../src/teams/teams.dto';

const teamId = '00000000-0000-4000-8000-000000000001';
const leaderId = '00000000-0000-4000-8000-000000000002';
const storedAt = '2026-10-29T08:00:00.000Z';

interface Current {
  longitude: number; latitude: number; accuracy_m: string | null; captured_at: string;
  source: 'GPS' | 'MANUAL_PIN' | 'COORDINATOR_REPORTED'; set_by_user_id: string; within_window: boolean; distance_m: number;
}
const stored = (overrides: Partial<Current> = {}): Current => ({
  longitude: 106.7, latitude: 10.77, accuracy_m: '8', captured_at: storedAt, source: 'GPS', set_by_user_id: leaderId,
  within_window: false, distance_m: 10, ...overrides,
});

function build(current?: Current) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('FROM rescue_team')) return [{ organization_id: 'o', operating_region_code: 'R', reporting_mode: 'APP', status: 'ACTIVE' }];
    if (sql.includes('FROM team_member')) return [{ '?column?': 1 }];
    if (sql.includes('FROM team_position')) return current ? [current] : [];
    return [];
  });
  const dataSource = { transaction: (work: (manager: { query: typeof query }) => Promise<unknown>) => work({ query }) } as unknown as DataSource;
  const sessions = { require: jest.fn(async () => ({ userId: leaderId, grants: [] })) } as unknown as ReporterSessionService;
  return { service: new TeamsPositionService(dataSource, sessions), query };
}
const dto = (overrides: Partial<{ source: 'GPS' | 'MANUAL_PIN'; capturedAt: string; longitude: number; latitude: number }> = {}) => ({
  location: { type: 'Point', coordinates: [overrides.longitude ?? 106.7001, overrides.latitude ?? 10.7701], source: overrides.source ?? 'GPS' },
  accuracy_m: 5, captured_at: overrides.capturedAt ?? '2026-10-29T08:45:00.000Z',
}) as unknown as SetTeamPositionDto;
const writes = (query: jest.Mock) => query.mock.calls.map(([sql]) => String(sql)).filter((sql) => /^\s*(UPDATE|INSERT)/u.test(sql));
const request = {} as Request;

describe('TeamsPositionService.set', () => {
  it('inserts the first position', async () => {
    const { service, query } = build();
    await service.set(teamId, dto(), request);
    expect(writes(query)[0]).toContain('INSERT INTO team_position');
  });

  it('ignores updates within the 15 second window', async () => {
    const { service, query } = build(stored({ within_window: true, distance_m: 300 }));
    await service.set(teamId, dto(), request);
    expect(writes(query)).toEqual([]);
  });

  it('refreshes only captured_at for a team that stayed within 25 m', async () => {
    const { service, query } = build(stored({ distance_m: 10 }));

    await service.set(teamId, dto({ capturedAt: '2026-10-29T08:45:00.000Z' }), request);

    expect(writes(query)).toEqual(['UPDATE team_position SET captured_at=$2 WHERE team_id=$1']);
    const call = query.mock.calls.find(([text]) => String(text).includes('SET captured_at=$2'));
    expect(call?.[1]).toEqual([teamId, '2026-10-29T08:45:00.000Z']);
  });

  it('does not rewind captured_at when a stationary update carries an older or equal time', async () => {
    for (const capturedAt of [storedAt, '2026-10-29T07:00:00.000Z']) {
      const { service, query } = build(stored());
      await service.set(teamId, dto({ capturedAt }), request);
      expect(writes(query)).toEqual([]);
    }
  });

  it('moves the stored location once the team travelled 25 m or more', async () => {
    const { service, query } = build(stored({ distance_m: 120 }));
    await service.set(teamId, dto(), request);
    const [sql] = writes(query);
    expect(sql).toContain('ST_MakePoint');
    expect(sql).toContain('location=');
  });

  it('keeps source and writes no audit for a stationary refresh, even from another source', async () => {
    const { service, query } = build(stored({ source: 'GPS', distance_m: 5 }));

    await service.set(teamId, dto({ source: 'MANUAL_PIN' }), request);

    expect(writes(query)).toEqual(['UPDATE team_position SET captured_at=$2 WHERE team_id=$1']);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO audit_log'))).toBe(false);
  });

  it('audits a move of 25 m or more that changes the source', async () => {
    const { service, query } = build(stored({ source: 'GPS', distance_m: 400 }));
    await service.set(teamId, dto({ source: 'MANUAL_PIN' }), request);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO audit_log'))).toBe(true);
  });
});
