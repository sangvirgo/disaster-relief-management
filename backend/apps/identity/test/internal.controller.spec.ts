import { describe, expect, it, jest } from '@jest/globals';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import { AppError } from '@c48/technical/errors/errors';
import { AdminRequest, IdentityServiceGuard } from '../src/admin/admin-security';
import { InternalController } from '../src/internal/internal.controller';
import { InternalService } from '../src/internal/internal.service';

describe('Identity internal request coordinator grants endpoint', () => {
  const dto = { campaign_id: '00000000-0000-4000-8000-000000000002' };

  function setup() {
    const check = jest.fn(async (_campaignId: string | null) => ({ items: [] }));
    const service = { requestCoordinators: check } as unknown as InternalService;
    const controller = new InternalController(service);
    const response = { setHeader: jest.fn() } as unknown as Response;
    return { check, controller, response };
  }

  it.each(['logistics', undefined])('rejects caller %s', async (serviceCaller) => {
    const { check, controller, response } = setup();
    let error: unknown;

    try {
      await controller.requestCoordinators(dto, { serviceCaller } as AdminRequest, response);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(check).not.toHaveBeenCalled();
  });

  it('requires the service-token guard', () => {
    const method = InternalController.prototype.requestCoordinators;
    expect(Reflect.getMetadata(GUARDS_METADATA, method)).toContain(IdentityServiceGuard);
  });

  it('returns grants only to Response and disables caching', async () => {
    const { check, controller, response } = setup();

    await expect(controller.requestCoordinators(dto, { serviceCaller: 'response' } as AdminRequest, response)).resolves.toEqual({ items: [] });

    expect(check).toHaveBeenCalledWith(dto.campaign_id);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('requests system coordinators for the unassigned queue', async () => {
    const { check, controller, response } = setup();
    await controller.requestCoordinators({}, { serviceCaller: 'response' } as AdminRequest, response);
    expect(check).toHaveBeenCalledWith(null);
  });
});

describe('Identity internal active user check endpoint', () => {
  const dto = { user_id: '00000000-0000-4000-8000-000000000001' };

  function setup() {
    const check = jest.fn(async () => ({ active: true }));
    const controller = new InternalController({ activeUserCheck: check } as unknown as InternalService);
    const response = { setHeader: jest.fn() } as unknown as Response;
    return { check, controller, response };
  }

  it.each(['logistics', undefined])('rejects caller %s', async (serviceCaller) => {
    const { check, controller, response } = setup();
    const handler = (controller as unknown as Record<string, (...args: unknown[]) => unknown>)['activeUserCheck'];
    expect(typeof handler).toBe('function');

    await expect(handler!.call(controller, dto, { serviceCaller } as AdminRequest, response))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(check).not.toHaveBeenCalled();
  });

  it('requires the service-token guard', () => {
    const handler = (InternalController.prototype as unknown as Record<string, unknown>)['activeUserCheck'];
    expect(typeof handler).toBe('function');
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(IdentityServiceGuard);
  });

  it('returns only account activity to Response and disables caching', async () => {
    const { check, controller, response } = setup();
    const handler = (controller as unknown as Record<string, (...args: unknown[]) => unknown>)['activeUserCheck'];
    expect(typeof handler).toBe('function');

    await expect(handler!.call(controller, dto, { serviceCaller: 'response' } as AdminRequest, response))
      .resolves.toEqual({ active: true });
    expect(check).toHaveBeenCalledWith(dto.user_id);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});

describe('Identity internal team leader eligibility endpoint', () => {
  const dto = { user_id: '00000000-0000-4000-8000-000000000001' };

  it('checks volunteer eligibility for Response only', async () => {
    const check = jest.fn(async (_userId: string) => ({ eligible: true }));
    const controller = new InternalController({ teamLeaderEligibility: check } as unknown as InternalService);
    const response = { setHeader: jest.fn() } as unknown as Response;
    await expect(controller.teamLeaderEligibility(dto, { serviceCaller: 'response' } as AdminRequest, response))
      .resolves.toEqual({ eligible: true });
    expect(check).toHaveBeenCalledWith(dto.user_id);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('rejects other service callers', async () => {
    const check = jest.fn(async () => ({ eligible: true }));
    const controller = new InternalController({ teamLeaderEligibility: check } as unknown as InternalService);
    const response = { setHeader: jest.fn() } as unknown as Response;
    await expect(controller.teamLeaderEligibility(dto, { serviceCaller: 'logistics' } as AdminRequest, response))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(check).not.toHaveBeenCalled();
  });
});
