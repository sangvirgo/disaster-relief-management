import { jest } from '@jest/globals';
import { decodeKeysetCursor } from '../../../packages/technical/src/keyset';
import { TrackingService } from '../src/tracking/tracking.service';

const requestId = '00000000-0000-4000-8000-000000000001';
const exactTime = '2026-10-11T12:34:56.123456Z';
const publicTime = '2026-10-11T12:34:56.123Z';

function makeService(rows: unknown[]) {
  const dataSource = { query: jest.fn().mockResolvedValue(rows) };
  const sessions = {
    require: jest.fn().mockResolvedValue({ userId: 'reporter-1' }),
    optional: jest.fn().mockResolvedValue(undefined),
  };
  const access = {
    validTrackingSecret: jest.fn().mockReturnValue(true),
    forRequest: jest.fn().mockResolvedValue({ id: requestId }),
  };
  return {
    service: new TrackingService(dataSource as never, {} as never, access as never, sessions as never, {} as never, {} as never),
    dataSource,
  };
}

describe('reporter keyset pagination', () => {
  it('preserves PostgreSQL microseconds in the personal request cursor', async () => {
    const { service, dataSource } = makeService([
      { id: requestId, tracking_code: '01HJKMNPQR', status: 'SUBMITTED', received_at: new Date(publicTime), cursor_received_at: exactTime },
      { id: '00000000-0000-4000-8000-000000000002', tracking_code: '01HJKMNPQS', status: 'SUBMITTED', received_at: new Date(publicTime), cursor_received_at: exactTime },
    ]);

    const page = await service.mine({ limit: 1 }, {} as never);
    expect(page.items[0]?.received_at).toBe(publicTime);
    expect(decodeKeysetCursor(page.cursor!, { reporter_user_id: 'reporter-1' }).sort).toEqual([exactTime]);
    expect(dataSource.query.mock.calls[0]?.[0]).toContain('to_char(received_at AT TIME ZONE');
  });

  it('preserves PostgreSQL microseconds in the reporter event cursor', async () => {
    const { service, dataSource } = makeService([
      { id: requestId, event_type: 'REPORTER_SUPPLEMENT', occurred_at: new Date(publicTime), cursor_occurred_at: exactTime, public_text_code: 'REPORTER_SUPPLEMENT' },
      { id: '00000000-0000-4000-8000-000000000002', event_type: 'REQUEST_SUBMITTED', occurred_at: new Date(publicTime), cursor_occurred_at: exactTime, public_text_code: 'REQUEST_SUBMITTED' },
    ]);

    const page = await service.events(requestId, '01HJKMNPQR', 'valid-secret', { limit: 1 }, {} as never);
    expect(page.items[0]?.occurred_at).toBe(publicTime);
    expect(decodeKeysetCursor(page.cursor!, { request_id: requestId, visibility: 'REPORTER' }).sort).toEqual([exactTime]);
    expect(dataSource.query.mock.calls[0]?.[0]).toContain('to_char(occurred_at AT TIME ZONE');
  });
});
