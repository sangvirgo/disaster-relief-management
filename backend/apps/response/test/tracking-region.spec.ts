import { jest } from '@jest/globals';
import { TrackingService } from '../src/tracking/tracking.service';

describe('reporter location corrections', () => {
  it('recalculates the queue region and clears it when the corrected point has no unique match', async () => {
    const manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT people_affected')) return [{
          people_affected: 2, household_reference_note: null, location_source: 'GPS', location_accuracy_m: 8,
          location_captured_at: null, longitude: 106.5, latitude: 10.5,
        }];
        if (sql.includes('SELECT min(region_code)')) return [];
        if (sql.includes('UPDATE assistance_request')) return [[{ status: 'SUBMITTED', version: 2, tracking_code: '01HJKMNPQR' }], 1];
        if (sql.includes('INSERT INTO request_event')) return [{ id: '00000000-0000-4000-8000-000000000002' }];
        return [];
      }),
    };
    const access = {
      validTrackingSecret: () => true,
      trackingSecretHash: () => 'purpose-bound-hash',
      forRequest: async () => ({
        id: '00000000-0000-4000-8000-000000000001', tracking_code: '01HJKMNPQR', status: 'SUBMITTED',
        version: 1, review_lane: 'NORMAL', description: 'Nước ngập.', reporter_declared_danger: false,
      }),
    };
    const idempotency = { execute: async (_dataSource: unknown, command: { execute: (manager: typeof manager) => Promise<unknown> }) => command.execute(manager) };
    const service = new TrackingService({} as never, idempotency as never, access as never, { optional: async () => undefined } as never, {} as never);

    await service.supplement(
      '00000000-0000-4000-8000-000000000001',
      { expected_version: 1, location: { type: 'Point', coordinates: [120.5, 10.5], source: 'MANUAL_PIN' } } as never,
      'idempotency-key', '01HJKMNPQR', 'valid-secret', {} as never,
    );

    const regionLookup = manager.query.mock.calls.find(([sql]) => sql.includes('SELECT min(region_code)'))?.[0];
    expect(regionLookup).toContain('ST_Covers');
    expect(regionLookup).toContain('HAVING count(*) = 1');
    const requestUpdate = manager.query.mock.calls.find(([sql]) => sql.includes('UPDATE assistance_request'));
    expect(requestUpdate?.[0]).toContain('region_code = CASE WHEN $6::boolean THEN $7::text ELSE region_code END');
    expect(requestUpdate?.[1]).toEqual(expect.arrayContaining([true, null]));
  });
});
