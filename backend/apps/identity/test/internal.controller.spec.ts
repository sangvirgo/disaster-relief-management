import { describe, expect, it, jest } from '@jest/globals';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import { AppError } from '../../../packages/technical/src/errors/errors';
import { AdminRequest, IdentityServiceGuard } from '../src/admin/admin-security';
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
