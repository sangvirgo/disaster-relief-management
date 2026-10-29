import { describe, expect, it, jest } from '@jest/globals';
import { validate } from 'class-validator';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import { AppError } from '@c48/technical/errors/errors';
import { AdminRequest, IdentityServiceGuard } from '../src/admin/admin-security';
import { RegionLookupDto } from '../src/internal/internal.dto';
import { InternalController } from '../src/internal/internal.controller';
import { InternalService } from '../src/internal/internal.service';

describe('Identity internal team leader eligibility endpoint', () => {
  const dto = {
    user_id: '00000000-0000-4000-8000-000000000001',
    organization_id: '00000000-0000-4000-8000-000000000002',
  };

  function setup() {
    const check = jest.fn(async (_userId: string, _organizationId: string) => ({ eligible: true }));
    const service = { teamLeaderEligibility: check } as unknown as InternalService;
    const controller = new InternalController(service);
    const response = { setHeader: jest.fn() } as unknown as Response;
    return { check, controller, response };
  }

  it.each(['logistics', undefined])('rejects caller %s', async (serviceCaller) => {
    const { check, controller, response } = setup();
    let error: unknown;

    try {
      await controller.teamLeaderEligibility(dto, { serviceCaller } as AdminRequest, response);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(check).not.toHaveBeenCalled();
  });

  it('requires the service-token guard', () => {
    const method = InternalController.prototype.teamLeaderEligibility;
    expect(Reflect.getMetadata(GUARDS_METADATA, method)).toContain(IdentityServiceGuard);
  });

  it('returns eligibility only to Response and disables caching', async () => {
    const { check, controller, response } = setup();

    await expect(controller.teamLeaderEligibility(dto, { serviceCaller: 'response' } as AdminRequest, response)).resolves.toEqual({ eligible: true });

    expect(check).toHaveBeenCalledWith(dto.user_id, dto.organization_id);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
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

describe('Identity internal region lookup endpoint', () => {
  const dto = { codes: ['VN01', 'VN02'] };

  function setup() {
    const lookup = jest.fn(async (codes: string[]) => ({ items: codes.map((code) => ({ code, name: `Tên ${code}` })) }));
    const service = { lookupRegions: lookup } as unknown as InternalService;
    const controller = new InternalController(service);
    const response = { setHeader: jest.fn() } as unknown as Response;
    return { lookup, controller, response };
  }

  it.each(['logistics', undefined])('rejects caller %s', async (serviceCaller) => {
    const { lookup, controller, response } = setup();
    await expect(controller.lookupRegions(dto, { serviceCaller } as AdminRequest, response))
      .rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('requires the service-token guard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, InternalController.prototype.lookupRegions)).toContain(IdentityServiceGuard);
  });

  it('returns names only to Response and disables caching', async () => {
    const { lookup, controller, response } = setup();
    const result = await controller.lookupRegions(dto, { serviceCaller: 'response' } as AdminRequest, response);

    expect(result).toEqual({ items: [{ code: 'VN01', name: 'Tên VN01' }, { code: 'VN02', name: 'Tên VN02' }] });
    expect(lookup).toHaveBeenCalledWith(dto.codes);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });
});

describe('Identity internal region lookup DTO', () => {
  async function errorsFor(codes: unknown): Promise<unknown[]> {
    return validate(Object.assign(new RegionLookupDto(), { codes }));
  }

  it('accepts up to 100 nonblank string codes of at most 80 characters', async () => {
    const errors = await errorsFor(['x'.repeat(80), ...Array.from({ length: 99 }, (_, index) => `R${index}`)]);
    expect(errors).toHaveLength(0);
    expect(await errorsFor(['VN01'])).toHaveLength(0);
  });

  it('rejects malformed region lookup codes', async () => {
    for (const codes of [
      'VN01',
      [],
      Array.from({ length: 101 }, (_, index) => `R${index}`),
      [''],
      ['   '],
      ['x'.repeat(81)],
      [42],
    ]) {
      expect(await errorsFor(codes)).not.toHaveLength(0);
    }
  });
});
