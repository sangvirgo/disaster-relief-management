import { describe, expect, it, jest } from '@jest/globals';
import { MissionsCommandsService } from '../src/missions/missions-commands.service';
import { teamView, type TeamRow } from '../src/teams/teams.helpers';

const mission = { id: '00000000-0000-4000-8000-000000000003', created_at: '2026-11-17T01:00:00.000Z' };

function assertTime(row: { in_future: boolean; too_early: boolean } | undefined, occurredAt = '2026-11-17T02:00:00.000Z') {
  const query = jest.fn(async () => (row ? [row] : []));
  const subject = new MissionsCommandsService({} as never, {} as never, {} as never, {} as never, {} as never) as unknown as {
    assertReportedTimeValid(manager: { query: typeof query }, mission: unknown, occurredAt: string): Promise<void>;
  };
  return { query, run: () => subject.assertReportedTimeValid({ query }, mission, occurredAt) };
}

describe('record-on-behalf reported time', () => {
  it('accepts a time between the mission history and now, comparing against mission creation and the last event', async () => {
    const { query, run } = assertTime({ in_future: false, too_early: false });
    await expect(run()).resolves.toBeUndefined();
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('FROM mission_event WHERE mission_id=$3');
    expect(values).toEqual(['2026-11-17T02:00:00.000Z', mission.created_at, mission.id]);
  });

  it('rejects a future time with a Vietnamese field error', async () => {
    await expect(assertTime({ in_future: true, too_early: false }).run()).rejects.toMatchObject({
      code: 'VALIDATION_FAILED', status: 400,
      fieldErrors: { occurred_at: ['Thời điểm đội báo không được nằm trong tương lai.'] },
    });
  });

  it('rejects a time before the mission was offered or the previous update', async () => {
    await expect(assertTime({ in_future: false, too_early: true }).run()).rejects.toMatchObject({
      code: 'VALIDATION_FAILED', status: 400,
      fieldErrors: { occurred_at: ['Thời điểm đội báo không được sớm hơn lúc giao nhiệm vụ hoặc lần cập nhật trước.'] },
    });
  });
});

describe('team contact note visibility', () => {
  const row = {
    id: 't1', name: 'Đội dân quân', team_kind: 'MILITARY', reporting_mode: 'COORDINATOR', availability: 'AVAILABLE', status: 'ACTIVE',
    readiness_required: false, version: 1, created_at: new Date(), skills: [], position_age_s: null, position_accuracy_m: null,
    position_source: null, longitude: null, latitude: null, external_contact_note: 'Bộ đàm kênh 5, anh Hùng',
  } as unknown as TeamRow;

  it('returns the note only to coordinators and only for coordinator-reported teams', () => {
    expect(teamView(row)).not.toHaveProperty('external_contact_note');
    expect(teamView(row, false, true)).toMatchObject({ external_contact_note: 'Bộ đàm kênh 5, anh Hùng' });
    expect(teamView({ ...row, reporting_mode: 'APP' } as TeamRow, false, true)).not.toHaveProperty('external_contact_note');
  });
});
