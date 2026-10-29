import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';
import { ApiExceptionFilter, loadErrorCatalog } from '@c48/technical';
import { LOGISTICS_AUTH_CONFIG } from '../src/auth/logistics-session.service';
import { LogisticsServiceTokenGuard } from '../src/auth/logistics-service-token.guard';
import { FulfillmentCyclesController } from '../src/fulfillment-cycles/fulfillment-cycles.controller';
import { FulfillmentCyclesService } from '../src/fulfillment-cycles/fulfillment-cycles.service';

const requestId = '11111111-1111-4111-8111-111111111111';
const intentId = '22222222-2222-4222-8222-222222222222';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const issuer = 'https://identity.test';

function serviceToken(sub: string, aud = 'logistics'): string {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: issuer, aud, sub, iat: issuedAt, exp: issuedAt + 300, jti: randomUUID() })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
}

describe('FulfillmentCyclesController HTTP', () => {
  let app: INestApplication;
  const cycles = {
    freeze: jest.fn(async () => ({ intent_id: intentId, cycle_state: 'FROZEN' })),
    seal: jest.fn(async () => ({ intent_id: intentId, cycle_state: 'SEALED' })),
    unseal: jest.fn(async () => ({ intent_id: intentId, cycle_state: 'OPEN' })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [FulfillmentCyclesController],
      providers: [
        LogisticsServiceTokenGuard,
        { provide: LOGISTICS_AUTH_CONFIG, useValue: { issuer, publicKey } },
        { provide: FulfillmentCyclesService, useValue: cycles },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1/logistics');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter(loadErrorCatalog(), 'logistics'));
    await app.init();
  });

  afterAll(async () => app.close());

  it('accepts a Logistics audience service token issued for Response', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/logistics/internal/requests/${requestId}/cycles/3/freeze`)
      .set('Authorization', `Bearer ${serviceToken('response')}`)
      .send({ intent_id: intentId })
      .expect(200)
      .expect('cache-control', 'no-store')
      .expect(({ body }) => expect(body.cycle_state).toBe('FROZEN'));
    expect(cycles.freeze).toHaveBeenCalledWith(requestId, 3, { intent_id: intentId });
  });

  it('rejects callers without the Response service identity', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/logistics/internal/requests/${requestId}/cycles/3/freeze`)
      .set('Authorization', `Bearer ${serviceToken('identity')}`)
      .send({ intent_id: intentId })
      .expect(401);
    expect(cycles.freeze).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown command fields and missing seal outcome basis', async () => {
    const auth = `Bearer ${serviceToken('response')}`;
    await request(app.getHttpServer())
      .post(`/api/v1/logistics/internal/requests/${requestId}/cycles/3/freeze`)
      .set('Authorization', auth)
      .send({ intent_id: intentId, unrecognized: true })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/logistics/internal/requests/${requestId}/cycles/3/seal`)
      .set('Authorization', auth)
      .send({ intent_id: intentId })
      .expect(400);
    expect(cycles.seal).not.toHaveBeenCalled();
  });
});
