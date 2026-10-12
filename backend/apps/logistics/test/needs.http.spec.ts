import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';
import { ApiExceptionFilter, loadErrorCatalog } from '../../../packages/technical/src';
import { LOGISTICS_IDENTITY_CLIENT, LOGISTICS_IDENTITY_CONFIG, LogisticsIdentityService } from '../src/auth/logistics-identity.service';
import { LOGISTICS_AUTH_CONFIG, LogisticsSessionService } from '../src/auth/logistics-session.service';
import { NeedsModule } from '../src/needs/needs.module';
import { NeedsService } from '../src/needs/needs.service';
import { ResponseAdmissionClient, RESPONSE_ADMISSION_CLIENT, RESPONSE_ADMISSION_CONFIG } from '../src/needs/response-admission.client';

const needId = '55555555-5555-4555-8555-555555555555';
const requestId = '11111111-1111-4111-8111-111111111111';
const itemId = '44444444-4444-4444-8444-444444444444';
const idempotencyKey = '77777777-7777-4777-8777-777777777777';

describe('POST /needs HTTP', () => {
  let app: INestApplication;
  const needs = {
    create: jest.fn(async () => ({
      status: 201,
      value: { id: needId, request_id: requestId, work_cycle: 2, item_id: itemId, status: 'OPEN' },
      replay: false,
    })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [NeedsModule] })
      .overrideProvider(NeedsService).useValue(needs)
      .overrideProvider(ResponseAdmissionClient).useValue({})
      .overrideProvider(RESPONSE_ADMISSION_CONFIG).useValue({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 2_000 })
      .overrideProvider(RESPONSE_ADMISSION_CLIENT).useValue({ close: () => undefined })
      .overrideProvider(LOGISTICS_AUTH_CONFIG).useValue({})
      .overrideProvider(LOGISTICS_IDENTITY_CONFIG).useValue({})
      .overrideProvider(LOGISTICS_IDENTITY_CLIENT).useValue({ close: () => undefined })
      .overrideProvider(LogisticsIdentityService).useValue({})
      .overrideProvider(LogisticsSessionService).useValue({})
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1/logistics');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter(loadErrorCatalog(), 'logistics'));
    await app.init();
  });

  afterAll(async () => app?.close());

  it('creates an idempotent need command with a no-store response', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/logistics/needs')
      .set('Idempotency-Key', idempotencyKey)
      .send({ request_id: requestId, work_cycle: 2, item_id: itemId, quantity: '3' })
      .expect(201)
      .expect('Cache-Control', 'no-store')
      .expect({ id: needId, request_id: requestId, work_cycle: 2, item_id: itemId, status: 'OPEN' });

    expect(needs.create).toHaveBeenCalledTimes(1);
    expect(needs.create.mock.calls[0]?.[0]).toMatchObject({ request_id: requestId, work_cycle: 2, item_id: itemId, quantity: '3' });
  });

  it('rejects client-supplied ownership attribution with Vietnamese validation copy', async () => {
    needs.create.mockClear();
    const result = await request(app.getHttpServer())
      .post('/api/v1/logistics/needs')
      .set('Idempotency-Key', idempotencyKey)
      .send({ request_id: requestId, work_cycle: 2, item_id: itemId, quantity: '3', organization_id: '88888888-8888-4888-8888-888888888888' });

    expect(result.status).toBe(400);
    expect(result.body.code).toBe('VALIDATION_FAILED');
    expect(result.body.message).toMatch(/[Ă-ưẠ-ỹ]/u);
    expect(needs.create).not.toHaveBeenCalled();
  });
});
