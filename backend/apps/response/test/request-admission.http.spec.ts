import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { jest } from '@jest/globals';
import { ApiExceptionFilter } from '../../../packages/technical/src/http/http-exception.filter';
import { loadErrorCatalog } from '../../../packages/technical/src/errors/error-catalog';
import { RequestAdmissionService } from '../src/operations/request-admission.service';
import { RequestAdmissionController } from '../src/operations/request-admission.controller';
import { ResponseServiceTokenGuard } from '../src/campaigns/service-token.guard';
import { REQUEST_INTAKE_CONFIG } from '../src/requests/request-intake.service';

const requestId = '11111111-1111-4111-8111-111111111111';
const issuer = 'c48-response-test';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });

function serviceToken(caller: 'identity' | 'logistics'): string {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: issuer, aud: 'response', sub: caller, iat: issuedAt, exp: issuedAt + 300, jti: randomUUID(),
  })).toString('base64url');
  const unsigned = `${header}.${claims}`;
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
}

describe('POST /internal/requests/:id/cycles/:work_cycle/admit HTTP', () => {
  let app: INestApplication;
  const admit = jest.fn(async () => ({
    request_id: requestId,
    work_cycle: 2,
    version: 5,
    status: 'TRIAGED',
    organization_id: '22222222-2222-4222-8222-222222222222',
    region_code: 'NORTH',
    campaign_id: null,
  }));

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [RequestAdmissionController],
      providers: [
        { provide: RequestAdmissionService, useValue: { admit } },
        ResponseServiceTokenGuard,
        { provide: REQUEST_INTAKE_CONFIG, useValue: { auth: { issuer, publicKey } } },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalFilters(new ApiExceptionFilter(loadErrorCatalog(), 'response'));
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('accepts Logistics service auth plus a separate actor bearer and returns the canonical version', async () => {
    const result = await request(app.getHttpServer())
      .post(`/internal/requests/${requestId}/cycles/2/admit`)
      .set('Authorization', `Bearer ${serviceToken('logistics')}`)
      .set('X-Actor-Authorization', 'Bearer identity.signed.actor')
      .send({ user_id: 'untrusted', grants: ['untrusted'] });

    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.body.version).toBe(5);
    expect(admit).toHaveBeenCalledTimes(1);
    const actorRequest = admit.mock.calls[0]?.[2] as { headers: Record<string, string> };
    expect(actorRequest.headers.authorization).toBe('Bearer identity.signed.actor');
  });

  it('rejects Identity service callers at the HTTP boundary', async () => {
    const result = await request(app.getHttpServer())
      .post(`/internal/requests/${requestId}/cycles/2/admit`)
      .set('Authorization', `Bearer ${serviceToken('identity')}`)
      .set('X-Actor-Authorization', 'Bearer identity.signed.actor')
      .send();

    expect(result.status).toBe(403);
    expect(result.body.code).toBe('FORBIDDEN');
    expect(result.body.message).toMatch(/[\u0102-\u01b0\u1ea0-\u1ef9]/u);
    expect(admit).toHaveBeenCalledTimes(1);
  });

  it('rejects decimal work-cycle values instead of truncating them', async () => {
    const result = await request(app.getHttpServer())
      .post(`/internal/requests/${requestId}/cycles/1.5/admit`)
      .set('Authorization', `Bearer ${serviceToken('logistics')}`)
      .set('X-Actor-Authorization', 'Bearer identity.signed.actor')
      .send();

    expect(result.status).toBe(400);
    expect(result.body.code).toBe('VALIDATION_FAILED');
    expect(result.body.message).toMatch(/[\u0102-\u01b0\u1ea0-\u1ef9]/u);
    expect(admit).toHaveBeenCalledTimes(1);
  });
});
