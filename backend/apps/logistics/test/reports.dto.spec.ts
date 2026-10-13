import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FulfillmentReportQueryDto, PublicDonationReportQueryDto, ReportPageQueryDto } from '../src/reports/reports.dto';

describe('Logistics report query contracts', () => {
  it('transforms and bounds keyset page size', async () => {
    const query = plainToInstance(ReportPageQueryDto, { limit: '25', cursor: 'opaque' });
    expect(query.limit).toBe(25);
    expect(await validate(query)).toHaveLength(0);

    const invalid = await validate(plainToInstance(ReportPageQueryDto, { limit: '101' }));
    expect(invalid.some((error) => error.property === 'limit')).toBe(true);
  });

  it('requires a bounded report window and at least one declared scope filter', async () => {
    const valid = plainToInstance(FulfillmentReportQueryDto, {
      region_code: 'R_1', from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z',
    });
    expect(await validate(valid)).toHaveLength(0);

    const missingWindow = await validate(plainToInstance(FulfillmentReportQueryDto, { campaign_id: '00000000-0000-4000-8000-000000000001' }));
    expect(missingWindow.map((error) => error.property)).toEqual(expect.arrayContaining(['from', 'to']));
  });

  it('accepts one public donation view selector', async () => {
    const query = plainToInstance(PublicDonationReportQueryDto, { drive_id: '00000000-0000-4000-8000-000000000001' });
    expect(await validate(query)).toHaveLength(0);

    const invalid = await validate(plainToInstance(PublicDonationReportQueryDto, { drive_id: 'not-a-uuid' }));
    expect(invalid.some((error) => error.property === 'drive_id')).toBe(true);
  });
});
