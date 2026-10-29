import { AppError } from '@c48/technical/errors/errors';
import { jest } from '@jest/globals';
import { DriveCampaignSyncService } from '../src/drives/drive-campaign-sync.service';

const campaignId = '22222222-2222-4222-8222-222222222222';
const driveId = '33333333-3333-4333-8333-333333333333';

describe('Logistics drive campaign synchronization', () => {
  it('keeps the cached campaign state when Response is unavailable', async () => {
    const transaction = jest.fn();
    const service = new DriveCampaignSyncService(
      { transaction } as never,
      { getCampaign: jest.fn(async () => { throw new AppError('RESPONSE_UNAVAILABLE', { status: 503 }); }) } as never,
    );

    await service.syncCampaign(campaignId);

    expect(transaction).not.toHaveBeenCalled();
  });

  it('closes open drives when Response closes their campaign and records the reason', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const manager = { query: jest.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.includes('FROM donation_drive')) return [{
        id: driveId, organization_id: '11111111-1111-4111-8111-111111111111', status: 'OPEN', campaign_status: 'ACTIVE', version: 2,
      }];
      if (sql.includes('UPDATE donation_drive')) return [{ id: driveId, version: 3 }];
      return [];
    }) };
    const dataSource = { transaction: jest.fn(async (work: (manager: never) => Promise<unknown>) => work(manager as never)) };
    const client = { getCampaign: jest.fn(async () => ({
      id: campaignId, status: 'CLOSED', organization_id: '11111111-1111-4111-8111-111111111111', region_code: 'R01', version: 4,
    })) };
    const service = new DriveCampaignSyncService(dataSource as never, client as never);

    await service.syncCampaign(campaignId);

    expect(calls.find(({ sql }) => sql.includes('UPDATE donation_drive'))?.values).toContain('CLOSED');
    const audit = calls.find(({ sql }) => sql.includes('INSERT INTO audit_log'));
    expect(audit?.sql).toContain("'CAMPAIGN_CLOSED'");
  });
});
