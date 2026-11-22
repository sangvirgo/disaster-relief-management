import { jest } from '@jest/globals';
import { ReporterAccessService } from '../src/tracking/reporter-access.service';
import { TrackingService } from '../src/tracking/tracking.service';

const requestId = '00000000-0000-4000-8000-000000000001';

describe('ReporterAccessService phone lookup', () => {
  it('returns the newest SOS matching the exact reporter phone', async () => {
    const row = {
      id: requestId,
      tracking_code: '01HJKMNPQR',
      reporter_user_id: null,
      status: 'SUBMITTED',
      version: 1,
      review_lane: 'NORMAL',
      received_at: '2026-10-11T12:34:56.123Z',
      campaign_id: null,
      incident_category_code: 'FLOOD',
      description: null,
      reporter_declared_danger: false,
      needs_rescue: false,
      needs_relief_supplies: false,
    };
    const query = jest.fn().mockResolvedValue([row]);
    const access = new ReporterAccessService({ query } as never);

    await expect(access.byReporterPhone('+84 (912) 345-678')).resolves.toEqual(row);

    const [sql, parameters] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('reporter_user_id IS NULL');
    expect(sql).toContain('reporter_contact_phone = $1');
    expect(sql).toContain('ORDER BY received_at DESC,id DESC LIMIT 1');
    expect(parameters).toEqual(['+84912345678']);
  });

  it('does not return a request when the phone has no matching SOS', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const access = new ReporterAccessService({ query } as never);

    await expect(access.byReporterPhone('+84912345678')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('rate-limits phone lookups across client IPs', async () => {
    const access = { byReporterPhone: jest.fn().mockRejectedValue({ code: 'NOT_FOUND', status: 404 }) };
    const service = new TrackingService({ query: jest.fn() } as never, {} as never, access as never, {} as never, {} as never, {} as never);
    const request = (ip: string) => ({ ip, socket: { remoteAddress: ip } }) as never;

    for (let attempt = 0; attempt < 10; attempt++) {
      await expect(service.trackByPhone('+84 (912) 345-678', request(`203.0.113.${attempt + 1}`)))
        .rejects.toMatchObject({ code: 'NOT_FOUND' });
    }

    await expect(service.trackByPhone('+84912345678', request('203.0.113.99')))
      .rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429 });
    expect(access.byReporterPhone).toHaveBeenCalledTimes(10);
  });
});
