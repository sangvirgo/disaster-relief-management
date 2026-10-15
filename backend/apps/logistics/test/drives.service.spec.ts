import { jest } from '@jest/globals';
import { DrivesService } from '../src/drives/drives.service';

const warehouseId = '11111111-1111-4111-8111-111111111111';
const campaignId = '22222222-2222-4222-8222-222222222222';
const organizationId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';
const key = '55555555-5555-4555-8555-555555555555';

describe('Logistics donation drive commands', () => {
  it('checks a linked campaign before opening the database command transaction', async () => {
    const dataSource = { query: jest.fn(async () => [{
      id: warehouseId, organization_id: organizationId, region_code: 'R01', status: 'ACTIVE',
    }]) };
    const session = {
      userId,
      grants: [{ role_code: 'CAMPAIGN_MANAGER', scope_type: 'ORGANIZATION', organization_id: organizationId, region_code: null, campaign_id: null }],
    };
    const sessions = { require: jest.fn(async () => session) };
    const idempotency = { execute: jest.fn() };
    const response = { getCampaign: jest.fn(async () => ({
      id: campaignId, status: 'PAUSED', organization_id: organizationId, region_code: 'R01', version: 3,
    })) };
    const service = new DrivesService(dataSource as never, idempotency as never, sessions as never, response as never);

    await expect(service.create({
      title: 'Hỗ trợ vùng lũ', intake_warehouse_id: warehouseId, campaign_id: campaignId,
      items: [{ item_id: '66666666-6666-4666-8666-666666666666', target_quantity: '10' }],
    }, { headers: {}, idempotencyKey: key } as never)).rejects.toMatchObject({ code: 'CAMPAIGN_NOT_ACTIVE', status: 409 });

    expect(response.getCampaign).toHaveBeenCalledWith(campaignId);
    expect(idempotency.execute).not.toHaveBeenCalled();
  });

  it('rejects a campaign owned by another organization before persisting a drive', async () => {
    const dataSource = { query: jest.fn(async () => [{
      id: warehouseId, organization_id: organizationId, region_code: 'R01', status: 'ACTIVE',
    }]) };
    const sessions = { require: jest.fn(async () => ({
      userId,
      grants: [{ role_code: 'CAMPAIGN_MANAGER', scope_type: 'ORGANIZATION', organization_id: organizationId, region_code: null, campaign_id: null }],
    })) };
    const idempotency = { execute: jest.fn() };
    const response = { getCampaign: jest.fn(async () => ({
      id: campaignId, status: 'ACTIVE', organization_id: '77777777-7777-4777-8777-777777777777', region_code: 'R01', version: 3,
    })) };
    const service = new DrivesService(dataSource as never, idempotency as never, sessions as never, response as never);

    await expect(service.create({
      title: 'Hỗ trợ vùng lũ', intake_warehouse_id: warehouseId, campaign_id: campaignId,
      items: [{ item_id: '66666666-6666-4666-8666-666666666666', target_quantity: '10' }],
    }, { headers: {}, idempotencyKey: key } as never)).rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
    expect(idempotency.execute).not.toHaveBeenCalled();
  });
});
