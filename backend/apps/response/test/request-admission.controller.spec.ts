import { jest } from '@jest/globals';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Request, Response } from 'express';
import { ResponseServiceTokenGuard } from '../src/campaigns/service-token.guard';
import { RequestAdmissionController } from '../src/operations/request-admission.controller';
import type { RequestAdmissionService } from '../src/operations/request-admission.service';

const requestId = '11111111-1111-4111-8111-111111111111';

function setup() {
  const admit = jest.fn(async () => ({ request_id: requestId }));
  const controller = new RequestAdmissionController({ admit } as unknown as RequestAdmissionService);
  const response = { setHeader: jest.fn() } as unknown as Response;
  return { admit, controller, response };
}

describe('RequestAdmissionController', () => {
  it('restricts the route to logistics service callers', async () => {
    const { admit, controller, response } = setup();

    await expect(controller.admit(requestId, '2', {
      serviceCaller: 'identity', headers: {},
    } as unknown as Request & { serviceCaller?: string }, response)).rejects.toMatchObject({
      code: 'FORBIDDEN', status: 403,
    });

    expect(admit).not.toHaveBeenCalled();
  });

  it('passes only the separate signed actor bearer to live session validation', async () => {
    const { admit, controller, response } = setup();
    const request = {
      serviceCaller: 'logistics',
      headers: {
        authorization: 'Bearer logistics-service-token',
        'x-actor-authorization': 'Bearer identity.signed.actor',
      },
    } as unknown as Request & { serviceCaller?: string };

    await controller.admit(requestId, '2', request, response);

    const actorRequest = admit.mock.calls[0]?.[2] as Request;
    expect(actorRequest.headers.authorization).toBe('Bearer identity.signed.actor');
    expect(actorRequest.headers['x-actor-authorization']).toBeUndefined();
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('requires an actor bearer independently of the logistics service token', async () => {
    const { admit, controller, response } = setup();

    await expect(controller.admit(requestId, '2', {
      serviceCaller: 'logistics', headers: { authorization: 'Bearer logistics-service-token' },
    } as unknown as Request & { serviceCaller?: string }, response)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED', status: 401,
    });

    expect(admit).not.toHaveBeenCalled();
  });

  it('rejects a non-integer work cycle path before admission', async () => {
    const { admit, controller, response } = setup();

    await expect(controller.admit(requestId, '1.5', {
      serviceCaller: 'logistics', headers: { 'x-actor-authorization': 'Bearer identity.signed.actor' },
    } as unknown as Request & { serviceCaller?: string }, response)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED', status: 400,
    });

    expect(admit).not.toHaveBeenCalled();
  });

  it('uses the service-token guard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, RequestAdmissionController.prototype.admit))
      .toContain(ResponseServiceTokenGuard);
  });
});
