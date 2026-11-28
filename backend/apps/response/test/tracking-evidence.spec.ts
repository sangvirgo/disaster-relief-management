import { jest } from '@jest/globals';
import { TrackingService } from '../src/tracking/tracking.service';

const requestId = '00000000-0000-4000-8000-000000000001';
const row = { id: requestId, tracking_code: '01HJKMNPQR', status: 'SUBMITTED', version: 1, review_lane: 'NORMAL', received_at: new Date('2026-11-23T10:00:00Z'), reporter_user_id: null };

function service(evidenceRows: unknown[]) {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('FROM evidence_metadata')) return evidenceRows;
    if (sql.includes('FROM request_event')) return [];
    return [];
  });
  const access = { byTrackingCode: jest.fn().mockResolvedValue(row) };
  const instance = new TrackingService({ query } as never, {} as never, access as never, {} as never, {} as never, {} as never);
  return { instance, query };
}

describe('tracking view evidence', () => {
  it('shows the accepted description and first verification narrative without raw staff payloads', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('first_verified_description')
      ? [{ first_verified_description: 'Có 12 người cần giúp.', rescue_progress: { active: 0, completed: 1 }, staff_note: 'private' }] : []);
    const access = { byTrackingCode: jest.fn().mockResolvedValue({ ...row, description: 'Có 14 người, đi vào phía sau nhà.' }) };
    const instance = new TrackingService({ query } as never, {} as never, access as never, {} as never, {} as never, {} as never);
    const view = await instance.track('01HJKMNPQR', { ip: '203.0.113.92', socket: {} } as never);
    expect(view.current_description).toBe('Có 14 người, đi vào phía sau nhà.');
    expect(view.first_verified_description).toBe('Có 12 người cần giúp.');
    expect(view.rescue_progress).toEqual({ active: 0, completed: 1 });
    expect(JSON.stringify(view)).not.toContain('private');
  });
  it('lists the reporter’s own READY files so they survive a reload or another device', async () => {
    const { instance, query } = service([
      { id: '00000000-0000-4000-8000-0000000000e1', state: 'READY', size_bytes: '720156', detected_mime: 'image/jpeg', checksum: 'abc', created_at: new Date('2026-11-23T10:05:00Z') },
    ]);
    const view = await instance.track('01HJKMNPQR', { ip: '203.0.113.90', socket: {} } as never) as { evidence: Array<Record<string, unknown>> };
    expect(view.evidence).toEqual([{
      id: '00000000-0000-4000-8000-0000000000e1', state: 'READY', size_bytes: 720156, detected_mime: 'image/jpeg', checksum: 'abc', created_at: '2026-11-23T10:05:00.000Z',
    }]);
    const [sql, values] = query.mock.calls.find(([text]) => (text as string).includes('FROM evidence_metadata'))! as unknown as [string, unknown[]];
    expect(sql).toContain("state='READY'");
    expect(sql).toContain('uploader_user_id IS NULL OR uploader_user_id IS NOT DISTINCT FROM $2');
    expect(values).toEqual([requestId, null]);
  });

  it('returns an empty list when nothing was uploaded', async () => {
    const { instance } = service([]);
    const view = await instance.track('01HJKMNPQR', { ip: '203.0.113.91', socket: {} } as never) as { evidence: unknown[] };
    expect(view.evidence).toEqual([]);
  });
});
