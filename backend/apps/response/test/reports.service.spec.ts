import type { Request } from 'express';
import { jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import type { Grant } from '../../../packages/identity-contracts/src/permissions';
import { ReportsService } from '../src/reports/reports.service';
import { MissionsConfig } from '../src/missions/missions.config';

const organizationId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const from = '2026-01-01T00:00:00Z';
const to = '2026-01-02T00:00:00Z';
const coordinatorGrant: Grant = { role_code: 'COORDINATOR', scope_type: 'ORGANIZATION', organization_id: organizationId };

function setup(row: unknown = {
  status_counts: { VERIFIED: '2' },
  priority_counts: { P1: '1' },
  median_verified_seconds: '3.5',
  median_offered_seconds: null,
  active_missions: '4',
  overdue_missions: '1',
}) {
  const query = jest.fn(async () => [row]);
  const dataSource = { query } as unknown as DataSource;
  const sessions = { require: jest.fn(async () => ({ userId, grants: [coordinatorGrant] })) };
  const config: MissionsConfig = { offerOverdueMinutes: 10 };
  return { service: new ReportsService(dataSource, sessions as never, config), query, sessions };
}

describe('ReportsService summary', () => {
  it('requires a region or campaign filter before querying', async () => {
    const { service, query } = setup();

    await expect(service.summary({ from, to }, {} as Request)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects report windows longer than 366 days', async () => {
    const { service, query } = setup();

    await expect(service.summary({ from, to: '2027-01-03T00:00:00Z', campaign_id: '00000000-0000-4000-8000-000000000003' }, {} as Request))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(query).not.toHaveBeenCalled();
  });

  it('returns scoped counts, medians, and mission totals without request data', async () => {
    const { service, query } = setup();

    const result = await service.summary({ from, to, region_code: 'VN01' }, {} as Request);

    expect(result).toMatchObject({
      filters: { from, to, campaign_id: null, region_code: 'VN01' },
      status_counts: { VERIFIED: 2 },
      priority_counts: { P1: 1 },
      median_seconds: { receipt_to_verification: 3.5, receipt_to_assignment: null },
      active_missions: 4,
      overdue_missions: 1,
    });
    expect(Object.keys(result as Record<string, unknown>).sort()).toEqual([
      'active_missions', 'filters', 'generated_at', 'median_seconds', 'overdue_missions', 'priority_counts', 'status_counts',
    ]);
    const [sql, values] = query.mock.calls[0]! as unknown as [string, unknown[]];
    expect(sql).toContain('r.received_at >= $');
    expect(sql).toContain('r.received_at < $');
    expect(sql).toContain('r.organization_id=$');
    expect(sql).toContain('MIN(m.created_at)');
    expect(sql).toContain('GROUP BY m.request_id');
    expect(sql).toContain("m.status IN ('OFFERED','ACCEPTED','EN_ROUTE','ON_SCENE')");
    expect(sql).toContain('statement_timestamp()');
    expect(sql).not.toMatch(/\bLATERAL\b|requester|reporter_contact_phone|tracking_code/i);
    expect(values).toContain(10);
  });

  it('rejects a caller without REPORT_READ before reading data', async () => {
    const { service, query, sessions } = setup();
    sessions.require.mockResolvedValue({
      userId,
      grants: [{ role_code: 'VOLUNTEER', scope_type: 'ORGANIZATION', organization_id: organizationId }],
    });

    await expect(service.summary({ from, to, campaign_id: '00000000-0000-4000-8000-000000000003' }, {} as Request))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(query).not.toHaveBeenCalled();
  });

  it('reuses results only after requiring the caller session', async () => {
    const { service, query, sessions } = setup();

    const first = await service.summary({ from, to, campaign_id: '00000000-0000-4000-8000-000000000003' }, {} as Request);
    const second = await service.summary({ from, to, campaign_id: '00000000-0000-4000-8000-000000000003' }, {} as Request);

    expect(second).toEqual(first);
    expect(sessions.require).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
