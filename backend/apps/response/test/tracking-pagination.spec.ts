import { jest } from '@jest/globals';
import { decodeKeysetCursor } from '../../../packages/technical/src/pagination/keyset';
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
    byTrackingCapability: jest.fn().mockRejectedValue({ code: 'NOT_FOUND', status: 404 }),
  };
  return {
    service: new TrackingService(dataSource as never, {} as never, access as never, sessions as never, {} as never, {} as never),
    dataSource,
    access,
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

    const request = { ip: '203.0.113.40', socket: { remoteAddress: '203.0.113.40' } } as never;
    const page = await service.events(requestId, '01HJKMNPQR', 'valid-secret', { limit: 1 }, request);
    expect(page.items[0]?.occurred_at).toBe(publicTime);
    expect(decodeKeysetCursor(page.cursor!, { request_id: requestId, visibility: 'REPORTER' }).sort).toEqual([exactTime]);
    expect(dataSource.query.mock.calls[0]?.[0]).toContain('to_char(occurred_at AT TIME ZONE');
  });

  it('limits tracking reads to ten per minute across track and event routes for each client IP', async () => {
    const { service, access } = makeService([]);
    const request = { ip: '203.0.113.41', socket: { remoteAddress: '203.0.113.41' } } as never;

    for (let attempt = 0; attempt < 10; attempt++) {
      await expect(service.track('01HJKMNPQR', 'secret', request)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    await expect(service.events(requestId, '01HJKMNPQR', 'secret', {}, request))
      .rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(access.byTrackingCapability).toHaveBeenCalledTimes(10);
    expect(access.forRequest).not.toHaveBeenCalled();
  });

  it('limits tracking reads to sixty per hour and releases the limit when the oldest request expires', async () => {
    let now = 1_000_000;
    const dateNow = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const { service, access } = makeService([]);
      const request = { ip: '203.0.113.42', socket: { remoteAddress: '203.0.113.42' } } as never;

      for (let tenMinuteWindow = 0; tenMinuteWindow < 6; tenMinuteWindow++) {
        if (tenMinuteWindow > 0) now += 10 * 60_000;
        for (let attempt = 0; attempt < 10; attempt++) {
          await expect(service.track('01HJKMNPQR', 'secret', request)).rejects.toMatchObject({ code: 'NOT_FOUND' });
        }
      }

      await expect(service.track('01HJKMNPQR', 'secret', request)).rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      now = 1_000_000 + 60 * 60_000;
      await expect(service.track('01HJKMNPQR', 'secret', request)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(access.byTrackingCapability).toHaveBeenCalledTimes(61);
    } finally {
      dateNow.mockRestore();
    }
  });

  it('limits full-map cleanup to once per minute and frees expired client keys', () => {
    let now = 1_000_000;
    const dateNow = jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const { service } = makeService([]);
      const limiter = (service as unknown as {
        readRateLimiter: { assertAllowed(clientIp: string): void; prune(timestamp: number): void };
      }).readRateLimiter;
      const prune = jest.spyOn(limiter, 'prune');
      const captureError = (clientIp: string): unknown => {
        try {
          limiter.assertAllowed(clientIp);
          return undefined;
        } catch (error) {
          return error;
        }
      };

      for (let client = 0; client < 20_000; client++) limiter.assertAllowed(`client-${client}`);

      expect(captureError('overflow-one')).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      expect(prune).toHaveBeenCalledTimes(1);
      now += 59_999;
      expect(captureError('overflow-two')).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      expect(prune).toHaveBeenCalledTimes(1);

      now += 1;
      expect(captureError('overflow-three')).toMatchObject({ code: 'RATE_LIMITED', status: 429 });
      expect(prune).toHaveBeenCalledTimes(2);
      now += 60 * 60_000;
      expect(captureError('after-expiry')).toBeUndefined();
      expect(prune).toHaveBeenCalledTimes(3);
    } finally {
      dateNow.mockRestore();
    }
  });
});
