import { jest } from '@jest/globals';
import type { CircuitBreakerClient, ServiceResponse } from '@c48/technical/http/service-client';
import { AppError } from '@c48/technical/errors/errors';
import type { LogisticsIdentityService } from '../src/auth/logistics-identity.service';
import { ResponseAdmissionClient } from '../src/needs/response-admission.client';

const requestId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const responseValue = {
  request_id: requestId, work_cycle: 2, version: 5, status: 'TRIAGED',
  organization_id: organizationId, region_code: 'NORTH', campaign_id: null,
};

function setup(result: ServiceResponse = { status: 200, headers: {}, body: responseValue }) {
  const client = { request: jest.fn(async () => result), close: jest.fn() };
  const identity = { serviceToken: jest.fn(async () => 'response-service-token') };
  const service = new ResponseAdmissionClient(client as unknown as CircuitBreakerClient, identity as unknown as LogisticsIdentityService);
  return { service, client, identity };
}

describe('ResponseAdmissionClient', () => {
  it('sends the Response service token separately from the signed actor bearer', async () => {
    const { service, client, identity } = setup();

    await expect(service.admit(requestId, 2, { authorization: 'Bearer identity.signed.actor' }))
      .resolves.toEqual(responseValue);

    expect(identity.serviceToken).toHaveBeenCalledWith('response');
    expect(client.request).toHaveBeenCalledWith(
      `/api/v1/response/internal/requests/${requestId}/cycles/2/admit`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer response-service-token',
          'x-actor-authorization': 'Bearer identity.signed.actor',
        },
      },
    );
  });

  it('extracts the Identity access credential from the authenticated web cookie', async () => {
    const { service, client } = setup();

    await service.admit(requestId, 2, { cookie: 'c48_pre=x; c48_access=identity.signed.actor; c48_csrf=y' });

    expect(client.request).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ 'x-actor-authorization': 'Bearer identity.signed.actor' }),
    }));
  });

  it('preserves contracted Response errors without forwarding arbitrary upstream copy', async () => {
    const { service } = setup({ status: 409, headers: {}, body: { code: 'REQUEST_NOT_VERIFIED', message: 'ignored' } });

    await expect(service.admit(requestId, 2, { authorization: 'Bearer identity.signed.actor' }))
      .rejects.toMatchObject({ code: 'REQUEST_NOT_VERIFIED', status: 409 });
  });

  it('preserves the pending supplement review conflict from Response', async () => {
    const { service } = setup({ status: 409, headers: {}, body: { code: 'PENDING_SUPPLEMENT_REVIEW', message: 'ignored' } });

    await expect(service.admit(requestId, 2, { authorization: 'Bearer identity.signed.actor' }))
      .rejects.toMatchObject({ code: 'PENDING_SUPPLEMENT_REVIEW', status: 409 });
  });

  it('fails closed on malformed Response admission data', async () => {
    const { service } = setup({ status: 200, headers: {}, body: { ...responseValue, request_id: 'wrong' } });

    await expect(service.admit(requestId, 2, { authorization: 'Bearer identity.signed.actor' }))
      .rejects.toMatchObject({ code: 'RESPONSE_UNAVAILABLE', status: 503 });
  });

  it('requires a valid signed actor bearer from the authenticated session', async () => {
    const { service, client } = setup();

    await expect(service.admit(requestId, 2, {})).rejects.toBeInstanceOf(AppError);
    expect(client.request).not.toHaveBeenCalled();
  });
});
