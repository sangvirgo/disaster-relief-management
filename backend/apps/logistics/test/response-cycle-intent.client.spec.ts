import { jest } from '@jest/globals';
import type { CircuitBreakerClient, ServiceResponse } from '@c48/technical/http/service-client';
import type { LogisticsIdentityService } from '../src/auth/logistics-identity.service';
import { ResponseCycleIntentClient } from '../src/integrations/response/response-cycle-intent.client';

const intentId = '22222222-2222-4222-8222-222222222222';
const requestId = '11111111-1111-4111-8111-111111111111';
const organizationId = '33333333-3333-4333-8333-333333333333';
const intentValue = {
  id: intentId,
  kind: 'RESOLUTION',
  state: 'PENDING',
  request_id: requestId,
  work_cycle: 3,
  request_status: 'RESOLVING',
  organization_id: organizationId,
  region_code: 'NORTH',
  campaign_id: null,
  outcome_basis: 'RESCUE_COMPLETED',
};

function setup(result: ServiceResponse = { status: 200, headers: {}, body: intentValue }) {
  const client = { request: jest.fn(async () => result), close: jest.fn() };
  const identity = { serviceToken: jest.fn(async () => 'response-service-token') };
  return {
    service: new ResponseCycleIntentClient(client as unknown as CircuitBreakerClient, identity as unknown as LogisticsIdentityService),
    client,
    identity,
  };
}

describe('ResponseCycleIntentClient', () => {
  it('uses a Logistics to Response service token to fetch the exact intent', async () => {
    const { service, client, identity } = setup();

    await expect(service.getIntent(intentId)).resolves.toEqual(intentValue);

    expect(identity.serviceToken).toHaveBeenCalledWith('response');
    expect(client.request).toHaveBeenCalledWith(
      `/api/v1/response/internal/operations/${intentId}`,
      { method: 'GET', headers: { authorization: 'Bearer response-service-token' } },
    );
  });

  it('fails closed when Response returns a different intent ID', async () => {
    const { service } = setup({ status: 200, headers: {}, body: { ...intentValue, id: requestId } });

    await expect(service.getIntent(intentId)).rejects.toMatchObject({ code: 'RESPONSE_UNAVAILABLE', status: 503 });
  });

  it('fails closed when attribution is incomplete or malformed', async () => {
    const { service } = setup({ status: 200, headers: {}, body: { ...intentValue, organization_id: 'bad' } });

    await expect(service.getIntent(intentId)).rejects.toMatchObject({ code: 'RESPONSE_UNAVAILABLE', status: 503 });
  });

  it('requires a recognized outcome basis when Response returns one', async () => {
    const { service } = setup({ status: 200, headers: {}, body: { ...intentValue, outcome_basis: 'OTHER' } });

    await expect(service.getIntent(intentId)).rejects.toMatchObject({ code: 'RESPONSE_UNAVAILABLE', status: 503 });
  });
});
