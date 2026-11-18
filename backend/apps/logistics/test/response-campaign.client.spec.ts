import { jest } from '@jest/globals';
import { LogisticsResponseCampaignClient } from '../src/integrations/response/response-campaign.client';
import { AppError } from '@c48/technical/errors/errors';

const campaignId = '66666666-6666-4666-8666-666666666666';

describe('Logistics Response campaign client', () => {
  it('requests a Response audience token and validates the internal campaign projection', async () => {
    const get = jest.fn(async () => ({
      status: 200,
      body: { id: campaignId, status: 'ACTIVE',  version: 3 },
    }));
    const identity = { serviceToken: jest.fn(async () => 'response-token') };
    const service = new LogisticsResponseCampaignClient({ get } as never, identity as never);

    await expect(service.getCampaign(campaignId)).resolves.toEqual({
      id: campaignId, status: 'ACTIVE',  version: 3,
    });
    expect(identity.serviceToken).toHaveBeenCalledWith('response');
    expect(get).toHaveBeenCalledWith(`/api/v1/response/internal/campaigns/${campaignId}`, {
      headers: { authorization: 'Bearer response-token' },
    });
  });

  it('accepts the published campaign area and rejects a half-present or malformed area', async () => {
    const identity = { serviceToken: async () => 'response-token' };
    const ok = new LogisticsResponseCampaignClient({ get: jest.fn(async () => ({
      status: 200, body: { id: campaignId, status: 'ACTIVE', version: 3, center: { lat: 10.5, lng: 106.25 }, radius_m: 3000 },
    })) } as never, identity as never);
    await expect(ok.getCampaign(campaignId)).resolves.toEqual({
      id: campaignId, status: 'ACTIVE', version: 3, center: { lat: 10.5, lng: 106.25 }, radius_m: 3000,
    });

    const noArea = new LogisticsResponseCampaignClient({ get: jest.fn(async () => ({
      status: 200, body: { id: campaignId, status: 'DRAFT', version: 1, center: null, radius_m: null },
    })) } as never, identity as never);
    await expect(noArea.getCampaign(campaignId)).resolves.toMatchObject({ center: null, radius_m: null });

    const halfArea = new LogisticsResponseCampaignClient({ get: jest.fn(async () => ({
      status: 200, body: { id: campaignId, status: 'ACTIVE', version: 3, center: { lat: 10, lng: 106 }, radius_m: null },
    })) } as never, identity as never);
    await expect(halfArea.getCampaign(campaignId)).rejects.toMatchObject({ code: 'RESPONSE_UNAVAILABLE' });

    const badRadius = new LogisticsResponseCampaignClient({ get: jest.fn(async () => ({
      status: 200, body: { id: campaignId, status: 'ACTIVE', version: 3, center: { lat: 10, lng: 106 }, radius_m: 999999 },
    })) } as never, identity as never);
    await expect(badRadius.getCampaign(campaignId)).rejects.toMatchObject({ code: 'RESPONSE_UNAVAILABLE' });
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
