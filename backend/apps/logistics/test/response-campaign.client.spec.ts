import { jest } from '@jest/globals';
import { LogisticsResponseCampaignClient } from '../src/drives/response-campaign.client';
import { AppError } from '../../../packages/technical/src/errors/errors';

const campaignId = '66666666-6666-4666-8666-666666666666';
const organizationId = '11111111-1111-4111-8111-111111111111';

describe('Logistics Response campaign client', () => {
  it('requests a Response audience token and validates the internal campaign projection', async () => {
    const get = jest.fn(async () => ({
      status: 200,
      body: { id: campaignId, status: 'ACTIVE', organization_id: organizationId, region_code: 'R01', version: 3 },
    }));
    const identity = { serviceToken: jest.fn(async () => 'response-token') };
    const service = new LogisticsResponseCampaignClient({ get } as never, identity as never);

    await expect(service.getCampaign(campaignId)).resolves.toEqual({
      id: campaignId, status: 'ACTIVE', organization_id: organizationId, region_code: 'R01', version: 3,
    });
    expect(identity.serviceToken).toHaveBeenCalledWith('response');
    expect(get).toHaveBeenCalledWith(`/api/v1/response/internal/campaigns/${campaignId}`, {
      headers: { authorization: 'Bearer response-token' },
    });
  });

  it('maps Response outages to the existing Logistics error code', async () => {
    const client = { get: jest.fn(async () => ({ status: 503, body: null })) };
    const service = new LogisticsResponseCampaignClient(client as never, { serviceToken: async () => 'token' } as never);

    await expect(service.getCampaign(campaignId)).rejects.toMatchObject({ code: 'RESPONSE_UNAVAILABLE', status: 503 });
  });

  it('maps Identity token failures to the existing Response unavailable error', async () => {
    const identity = { serviceToken: jest.fn(async () => { throw new AppError('IDENTITY_UNAVAILABLE', { status: 503 }); }) };
    const service = new LogisticsResponseCampaignClient({ get: jest.fn() } as never, identity as never);

    await expect(service.getCampaign(campaignId)).rejects.toMatchObject({ code: 'RESPONSE_UNAVAILABLE', status: 503 });
  });
});
