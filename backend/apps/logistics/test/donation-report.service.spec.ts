import { jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import { AppError } from '../../../packages/technical/src/errors/errors';
import { finalDistributionHandoffPredicate } from '../src/reports/donation-report.helpers';
import { DonationReportService } from '../src/reports/donation-report.service';

describe('DonationReportService', () => {
  it('returns posted accepted quantities by drive and caches each public page for 60 seconds', async () => {
    const query = jest.fn<(sql: string, parameters?: unknown[]) => Promise<Array<Record<string, unknown>>>>().mockResolvedValue([{
      item_id: '00000000-0000-4000-8000-000000000001', item_name: 'Nước uống',
      unit_code: 'BOTTLE', unit_name: 'Chai', unit_scale: 0, quantity: '7',
    }]);
    const reports = new DonationReportService({ query } as unknown as DataSource);
    const params = { drive_id: '00000000-0000-4000-8000-000000000002', limit: 20 };

    const first = await reports.summary(params);
    const second = await reports.summary(params);

    expect(first).toMatchObject({
      view: 'DRIVE_ACCEPTED', filter_id: params.drive_id,
      items: [{ item: { id: '00000000-0000-4000-8000-000000000001', name: 'Nước uống' },
        unit: { code: 'BOTTLE', display_name: 'Chai', scale: 0 }, accepted: '7' }],
      more: false,
    });
    expect(typeof first.generated_at).toBe('string');
    expect(second.generated_at).toBe(first.generated_at);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('requires exactly one public view filter', async () => {
    const query = jest.fn<(sql: string, parameters?: unknown[]) => Promise<Array<Record<string, unknown>>>>();
    const reports = new DonationReportService({ query } as unknown as DataSource);

    await expect(reports.summary({})).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(reports.summary({ drive_id: 'drive-1', campaign_id: 'campaign-1' })).rejects.toBeInstanceOf(AppError);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    [{ campaign_id: '00000000-0000-4000-8000-000000000010' }, 'distribution.campaign_id=$1::uuid'],
    [{ warehouse_id: '00000000-0000-4000-8000-000000000011' }, 'distribution.warehouse_id=$1::uuid'],
  ])('uses final-recipient handoffs for %s without drive attribution', async (filters, targetFilter) => {
    const query = jest.fn<(sql: string, parameters?: unknown[]) => Promise<Array<Record<string, unknown>>>>().mockResolvedValue([]);
    const reports = new DonationReportService({ query } as unknown as DataSource);

    await reports.summary(filters);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain(targetFilter);
    expect(sql).toContain(finalDistributionHandoffPredicate);
    expect(finalDistributionHandoffPredicate).toContain("handoff.handoff_kind='HOUSEHOLD_HANDOUT'");
    expect(finalDistributionHandoffPredicate).not.toContain('POINT_RECEIPT');
    expect(sql).not.toContain('donation_drive');
  });

  it.each([
    {
      filters: { campaign_id: '00000000-0000-4000-8000-000000000010' },
      view: 'CAMPAIGN_DISTRIBUTED',
      filterId: '00000000-0000-4000-8000-000000000010',
    },
    {
      filters: { warehouse_id: '00000000-0000-4000-8000-000000000011' },
      view: 'WAREHOUSE_DISTRIBUTED',
      filterId: '00000000-0000-4000-8000-000000000011',
    },
  ])('maps $view rows to distributed quantities', async ({ filters, view, filterId }) => {
    const query = jest.fn<(sql: string, parameters?: unknown[]) => Promise<Array<Record<string, unknown>>>>().mockResolvedValue([{
      item_id: '00000000-0000-4000-8000-000000000012', item_name: 'Gạo',
      unit_code: 'KG', unit_name: 'Ki-lô-gam', unit_scale: 3, quantity: '12.500',
    }]);
    const reports = new DonationReportService({ query } as unknown as DataSource);

    const result = await reports.summary(filters);

    expect(result).toMatchObject({
      view,
      filter_id: filterId,
      items: [{
        item: { id: '00000000-0000-4000-8000-000000000012', name: 'Gạo' },
        unit: { code: 'KG', display_name: 'Ki-lô-gam', scale: 3 },
        distributed: '12.500',
      }],
      more: false,
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
