import { jest } from '@jest/globals';
import { DataSource } from 'typeorm';
import { MissionsOverdueService } from '../src/missions/missions-overdue.service';
import { ReporterSessionService } from '../src/requests/reporter-session';

const organizationId = '00000000-0000-4000-8000-000000000001';
const coordinatorId = '00000000-0000-4000-8000-000000000002';
const matchingMissionId = '00000000-0000-4000-8000-000000000003';
const otherRegionMissionId = '00000000-0000-4000-8000-000000000004';

interface MissionsOverdueTestSurface {
  scanOverdue(): Promise<number>;
}

describe('MissionsOverdueService', () => {
  it('creates notices only for coordinators whose grant covers each overdue mission', async () => {
    const rows = [
      { id: matchingMissionId, version: 2, organization_id: organizationId, region_code: 'T8_REGION', campaign_id: null },
      { id: otherRegionMissionId, version: 3, organization_id: organizationId, region_code: 'T8_OTHER', campaign_id: null },
    ];
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('pg_try_advisory_xact_lock')) return [{ locked: true }];
      return sql.includes('FROM mission m JOIN assistance_request r') ? rows : [];
    });
    const manager = { query };
    const insertNotice = jest.fn(async () => []);
    const dataSource = {
      transaction: (work: (transactionManager: typeof manager) => Promise<unknown>) => work(manager),
      query: insertNotice,
    } as unknown as DataSource;
    const sessions = {
      requestCoordinatorGrants: jest.fn(async () => [{
        user_id: coordinatorId,
        role_code: 'COORDINATOR' as const,
        scope_type: 'REGION' as const,
        organization_id: organizationId,
        region_code: 'T8_REGION',
        campaign_id: null,
      }]),
    } as unknown as ReporterSessionService;
    const service = new MissionsOverdueService(dataSource, sessions, { offerOverdueMinutes: 10 });

    const created = await (service as unknown as MissionsOverdueTestSurface).scanOverdue();

    expect(created).toBe(1);
    expect(sessions.requestCoordinatorGrants).toHaveBeenCalledWith(organizationId);
    expect(insertNotice).toHaveBeenCalledWith(
      expect.stringContaining("'MISSION_OFFER_OVERDUE'"),
      [[matchingMissionId], [2], [coordinatorId]],
    );
  });
});
