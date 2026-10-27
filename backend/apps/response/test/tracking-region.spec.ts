import { jest } from '@jest/globals';
import type { ReporterRequestRow } from '../src/tracking/reporter-access.service';
import { TrackingService } from '../src/tracking/tracking.service';

describe('reporter location corrections', () => {
  it('recalculates the queue region and clears it when the corrected point has no unique match', async () => {
    const manager = {
      query: jest.fn(async (sql: string, _parameters: unknown[] = []) => {
        if (sql.includes('SELECT people_affected')) return [{
          people_affected: 2, children_count: null, elderly_count: null, household_reference_note: null, location_source: 'GPS', location_accuracy_m: 8,
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
      forRequest: async (): Promise<ReporterRequestRow> => ({
        id: '00000000-0000-4000-8000-000000000001', tracking_code: '01HJKMNPQR', status: 'SUBMITTED',
        version: 1, review_lane: 'NORMAL', description: 'Nước ngập.', reporter_declared_danger: false,
        needs_rescue: true, needs_relief_supplies: false,
        tracking_secret_hash: 'purpose-bound-hash', reporter_user_id: null, received_at: '2026-10-26T00:00:00Z',
        organization_id: '70000000-0000-4000-8000-000000000001', region_code: 'DEMO_A', campaign_id: null,
      }),
    };
    const idempotency = { execute: async (_dataSource: unknown, command: { execute: (transactionManager: typeof manager) => Promise<unknown> }) => command.execute(manager) };
    const service = new TrackingService({} as never, idempotency as never, access as never, { optional: async () => undefined } as never, {} as never, {} as never);

    const result = await service.supplement(
      '00000000-0000-4000-8000-000000000001',
      { expected_version: 1, location: { type: 'Point', coordinates: [120.5, 10.5], source: 'MANUAL_PIN' } } as never,
      'idempotency-key', '01HJKMNPQR', 'valid-secret', {} as never,
    );

    expect(result).toMatchObject({ status: 201, value: { status: 'SUBMITTED', version: 2 } });
    const regionLookup = manager.query.mock.calls.find(([sql]) => sql.includes('SELECT min(region_code)'));
    expect(regionLookup?.[1]).toEqual([120.5, 10.5]);
    const requestUpdate = manager.query.mock.calls.find(([sql]) => sql.includes('UPDATE assistance_request'));
    expect(requestUpdate?.[1]).toEqual(['00000000-0000-4000-8000-000000000001', 1, null]);
    const subjectUpdate = manager.query.mock.calls.find(([sql]) => sql.includes('UPDATE request_subject'));
    expect(subjectUpdate?.[1]).toEqual(['00000000-0000-4000-8000-000000000001', 120.5, 10.5, 'MANUAL_PIN', null, null]);
  });
});
