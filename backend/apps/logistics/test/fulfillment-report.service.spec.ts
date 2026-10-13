import type { Request } from 'express';
import type { DataSource } from 'typeorm';
import { jest } from '@jest/globals';
import { AppError } from '../../../packages/technical/src/errors/errors';
import type { LogisticsSessionService } from '../src/auth/logistics-session.service';
import { FulfillmentReportService } from '../src/reports/fulfillment-report.service';

describe('FulfillmentReportService', () => {
  it('keeps original, reduced/cancelled, active request, delivery and active outstanding separate', async () => {
    const query = jest.fn<(sql: string, parameters?: unknown[]) => Promise<Array<Record<string, unknown>>>>().mockResolvedValue([{
      need_id: '00000000-0000-4000-8000-000000000001', request_id: 'request-1', cycle_id: 'cycle-1', work_cycle: 2,
      region_code: 'R1', campaign_id: null, item_id: 'item-1', item_name: 'Gạo', unit_code: 'KG', unit_name: 'Kilôgam',
      unit_scale: 3, original: '20.000', reduced: '0.000', cancelled_remaining: '8.000', active_requested: '0.000',
      delivered: '12.000', active_outstanding: '0.000', status: 'CANCELLED',
    }]);
    const dataSource = { query } as unknown as DataSource;
    const sessions = {
      require: jest.fn<(request: Request) => Promise<{ userId: string; grants: Array<Record<string, unknown>> }>>().mockResolvedValue({
        userId: 'user-1', grants: [{ role_code: 'COORDINATOR', scope_type: 'REGION', organization_id: 'org-1', region_code: 'R1' }],
      }),
    } as unknown as LogisticsSessionService;
    const reports = new FulfillmentReportService(dataSource, sessions);

    const result = await reports.summary({
      region_code: 'R1', from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z', limit: 1,
    }, {} as Request);

    expect(result.items).toEqual([{
      id: '00000000-0000-4000-8000-000000000001', request_id: 'request-1', cycle_id: 'cycle-1', work_cycle: 2,
      region_code: 'R1', campaign_id: null,
      item: { id: 'item-1', name: 'Gạo' }, unit: { code: 'KG', display_name: 'Kilôgam', scale: 3 },
      original: '20.000', reduced: '0.000', cancelled_remaining: '8.000', active_requested: '0.000',
      delivered: '12.000', active_outstanding: '0.000', status: 'CANCELLED',
    }]);
    expect(result.more).toBe(false);
    expect(typeof result.generated_at).toBe('string');
  });

  it('rejects a report without an explicit campaign or region scope before querying', async () => {
    const query = jest.fn<(sql: string, parameters?: unknown[]) => Promise<Array<Record<string, unknown>>>>();
    const dataSource = { query } as unknown as DataSource;
    const sessions = {
      require: jest.fn<(request: Request) => Promise<{ userId: string; grants: Array<Record<string, unknown>> }>>()
        .mockResolvedValue({ userId: 'user-1', grants: [] }),
    } as unknown as LogisticsSessionService;
    const reports = new FulfillmentReportService(dataSource, sessions);

    await expect(reports.summary({ from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' }, {} as Request))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(query).not.toHaveBeenCalled();
  });
});
