import type { Request } from 'express';
import { jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import { EvidenceService } from '../src/evidence/evidence.service';

const requestId = '00000000-0000-4000-8000-000000000001';
const campaignId = '00000000-0000-4000-8000-000000000002';

describe('staff evidence request scope', () => {
  it('requires REQUEST_VERIFY scope for an unassigned request', async () => {
    const query = jest.fn(async () => [{
      id: requestId, status: 'SUBMITTED', review_lane: 'NORMAL', campaign_id: null,
    }]);
    const sessions = {
      require: jest.fn(async () => ({
        userId: '00000000-0000-4000-8000-000000000003',
        grants: [{ role_code: 'COORDINATOR', scope_type: 'CAMPAIGN', campaign_id: campaignId }],
      })),
    };
    const service = new EvidenceService(
      { query } as unknown as DataSource,
      {} as never,
      {} as never,
      sessions as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.uploadStaff(requestId, '00000000-0000-4000-8000-000000000004', {} as Request))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain('SELECT id,status,review_lane,campaign_id FROM assistance_request');
  });
});
