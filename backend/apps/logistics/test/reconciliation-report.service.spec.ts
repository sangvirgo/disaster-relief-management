import { jest } from '@jest/globals';
import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import type { LogisticsSessionService } from '../src/auth/logistics-session.service';
import { physicalHandoffsLateralSql } from '../src/reports/reconciliation-report.helpers';
import { ReconciliationReportService } from '../src/reports/reconciliation-report.service';

describe('ReconciliationReportService', () => {
  it('reports physical quantities and both independent reconciliation flags per item', async () => {
    const query = jest.fn<(sql: string, parameters?: unknown[]) => Promise<Array<Record<string, unknown>>>>()
      .mockResolvedValueOnce([{ id: 'warehouse-1' }])
      .mockResolvedValueOnce([
        {
          balance_id: 'balance-1',
          item_id: '00000000-0000-4000-8000-000000000001', item_name: 'Gạo', unit_code: 'KG', unit_name: 'Kilôgam', unit_scale: 3,
          intake_accepted: '12.000', posted_movements: '8.000', posted_reserved_movements: '-2.000', reserved: '2.000',
          issued_in_transit: '3.000', at_point: '1.000', delivered: '5.000', returned: '1.000', lost: '0.000',
          balance_mismatch: true, commitment_counter_mismatch: false,
        },
        {
          balance_id: 'balance-2',
          item_id: '00000000-0000-4000-8000-000000000002', item_name: 'Nước', unit_code: 'L', unit_name: 'Lít', unit_scale: 2,
          intake_accepted: '4.50', posted_movements: '5.25', posted_reserved_movements: '-1.25', reserved: '1.25',
          issued_in_transit: '2.50', at_point: '0.75', delivered: '3.25', returned: '0.50', lost: '0.25',
          balance_mismatch: false, commitment_counter_mismatch: true,
        },
      ]);
    const dataSource = { query } as unknown as DataSource;
    const sessions = {
      require: jest.fn<(request: Request) => Promise<{ userId: string; grants: Array<Record<string, unknown>> }>>().mockResolvedValue({
        userId: 'user-1', grants: [{ role_code: 'REVIEWER', scope_type: 'ORGANIZATION', organization_id: 'org-1' }],
      }),
    } as unknown as LogisticsSessionService;
    const reports = new ReconciliationReportService(dataSource, sessions);

    const result = await reports.summary({ warehouse_id: 'warehouse-1', limit: 20 }, {} as Request);

    expect(result.items).toEqual([
      {
        item: { id: '00000000-0000-4000-8000-000000000001', name: 'Gạo' },
        unit: { code: 'KG', display_name: 'Kilôgam', scale: 3 },
        intake_accepted: '12.000', posted_movements: '8.000', posted_reserved_movements: '-2.000', reserved: '2.000',
        issued_in_transit: '3.000', at_point: '1.000', delivered: '5.000', returned: '1.000', lost: '0.000',
        flags: { balance_mismatch: true, commitment_counter_mismatch: false },
      },
      {
        item: { id: '00000000-0000-4000-8000-000000000002', name: 'Nước' },
        unit: { code: 'L', display_name: 'Lít', scale: 2 },
        intake_accepted: '4.50', posted_movements: '5.25', posted_reserved_movements: '-1.25', reserved: '1.25',
        issued_in_transit: '2.50', at_point: '0.75', delivered: '3.25', returned: '0.50', lost: '0.25',
        flags: { balance_mismatch: false, commitment_counter_mismatch: true },
      },
    ]);
    expect(query).toHaveBeenCalledTimes(2);
    expect(result.more).toBe(false);
    expect(typeof result.generated_at).toBe('string');
    const reportSql = String(query.mock.calls[1]?.[0]);
    expect(reportSql).toContain(physicalHandoffsLateralSql);
    expect(reportSql).toContain('COALESCE(physical_handoffs.delivered,0)');
    expect(reportSql).toContain('COALESCE(physical_handoffs.returned,0)');
    expect(reportSql).toContain('COALESCE(physical_handoffs.lost,0)');
    expect(reportSql).toContain('distribution_line.commitment_id IS NULL');
    expect(reportSql).toContain("handoff.handoff_kind='DIRECT_HOUSEHOLD'");
    expect(reportSql).toContain("handoff.handoff_kind='HOUSEHOLD_HANDOUT'");
    expect(reportSql).toContain("loss_review.decision='APPROVE'");
    expect(reportSql).not.toContain("handoff.handoff_kind='POINT_RECEIPT'");
    expect(reportSql).toContain('distribution.relief_point_id IS NOT NULL');
    expect(reportSql.match(/FROM issued_line_settlement settlement WHERE settlement.handoff_line_id=line.id/gu)).toHaveLength(2);
    expect(reportSql).not.toContain("handoff.source_stage='IN_TRANSIT'");
  });

  it('returns not found if the requested warehouse is outside the caller scope', async () => {
    const query = jest.fn<(sql: string, parameters?: unknown[]) => Promise<Array<Record<string, unknown>>>>().mockResolvedValue([]);
    const sessions = {
      require: jest.fn<(request: Request) => Promise<{ userId: string; grants: Array<Record<string, unknown>> }>>().mockResolvedValue({
        userId: 'user-1', grants: [{ role_code: 'REVIEWER', scope_type: 'ORGANIZATION', organization_id: 'org-1' }],
      }),
    } as unknown as LogisticsSessionService;
    const reports = new ReconciliationReportService({ query } as unknown as DataSource, sessions);

    await expect(reports.summary({ warehouse_id: 'warehouse-outside-scope' }, {} as Request))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
