import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { Request } from 'express';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';
import { ApiExceptionFilter, loadErrorCatalog } from '../../../packages/technical/src';
import { LOGISTICS_IDENTITY_CLIENT, LOGISTICS_IDENTITY_CONFIG, LogisticsIdentityService } from '../src/auth/logistics-identity.service';
import { LOGISTICS_AUTH_CONFIG, LogisticsSessionService } from '../src/auth/logistics-session.service';
import { NeedCommandsService } from '../src/needs/need-commands.service';
import { NeedCommitmentsService } from '../src/needs/need-commitments.service';
import { NeedsQueriesService } from '../src/needs/needs-queries.service';
import { NeedsModule } from '../src/needs/needs.module';
import { NeedsService } from '../src/needs/needs.service';
import { ResponseAdmissionClient, RESPONSE_ADMISSION_CLIENT, RESPONSE_ADMISSION_CONFIG } from '../src/needs/response-admission.client';
import { LOGISTICS_RESPONSE_CLIENT, LogisticsResponseCampaignClient, RESPONSE_CAMPAIGN_CONFIG } from '../src/integrations/response/response-campaign.client';
import { LogisticsServiceTokenGuard } from '../src/auth/logistics-service-token.guard';
import type { AdjustNeedQuantityDto, CancelNeedDto, CreateNeedCommitmentDto, CreateNeedDto, FulfillmentQueryDto, NeedContributionsQueryDto, NeedsListQueryDto, ReleaseCommitmentDto } from '../src/needs/needs.dto';

const needId = '55555555-5555-4555-8555-555555555555';
const requestId = '11111111-1111-4111-8111-111111111111';
const itemId = '44444444-4444-4444-8444-444444444444';
const idempotencyKey = '77777777-7777-4777-8777-777777777777';

describe('POST /needs HTTP', () => {
  let app: INestApplication;
  const needs = {
    create: jest.fn(async (_dto: CreateNeedDto, _request: Request) => ({
      status: 201,
      value: { id: needId, request_id: requestId, work_cycle: 2, item_id: itemId, status: 'OPEN' },
      replay: false,
    })),
  };
  const commands = {
    increase: jest.fn(async (_id: string, _dto: AdjustNeedQuantityDto, _request: Request) => ({ status: 200, value: { id: needId, requested_quantity: '4' }, replay: true })),
    reduce: jest.fn(async (_id: string, _dto: AdjustNeedQuantityDto, _request: Request) => ({ status: 200, value: { id: needId, requested_quantity: '2' }, replay: false })),
    cancel: jest.fn(async (_id: string, _dto: CancelNeedDto, _request: Request) => ({ status: 200, value: { id: needId, status: 'CANCELLED' }, replay: false })),
  };
  const commitments = {
    create: jest.fn(async (_id: string, _dto: CreateNeedCommitmentDto, _request: Request) => ({ status: 201, value: { id: '99999999-9999-4999-8999-999999999999', quantity: '1.25' }, replay: false })),
    release: jest.fn(async (_id: string, _dto: ReleaseCommitmentDto, _request: Request) => ({ status: 200, value: { id: '99999999-9999-4999-8999-999999999999', released_quantity: '0.5' }, replay: true })),
  };
  const queries = {
    list: jest.fn(async (_query: NeedsListQueryDto, _request: Request) => ({ items: [], more: false })),
    fulfillment: jest.fn(async (_requestId: string, _query: FulfillmentQueryDto, _request: Request) => ({ needs: [], cycle_state: 'OPEN', generated_at: '2026-10-13T00:00:00.000Z' })),
    contributions: jest.fn(async (_needId: string, _query: NeedContributionsQueryDto, _request: Request) => ({ items: [], more: false })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [NeedsModule] })
      .overrideProvider(NeedsService).useValue(needs)
      .overrideProvider(NeedCommandsService).useValue(commands)
      .overrideProvider(NeedCommitmentsService).useValue(commitments)
      .overrideProvider(NeedsQueriesService).useValue(queries)
      .overrideGuard(LogisticsServiceTokenGuard).useValue({ canActivate: () => true })
      .overrideProvider(ResponseAdmissionClient).useValue({})
      .overrideProvider(RESPONSE_ADMISSION_CONFIG).useValue({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 2_000 })
      .overrideProvider(RESPONSE_ADMISSION_CLIENT).useValue({ close: () => undefined })
      .overrideProvider(LOGISTICS_AUTH_CONFIG).useValue({})
      .overrideProvider(LOGISTICS_IDENTITY_CONFIG).useValue({})
      .overrideProvider(LOGISTICS_IDENTITY_CLIENT).useValue({ close: () => undefined })
      .overrideProvider(LogisticsIdentityService).useValue({})
      .overrideProvider(RESPONSE_CAMPAIGN_CONFIG).useValue({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 2_000 })
      .overrideProvider(LOGISTICS_RESPONSE_CLIENT).useValue({ close: () => undefined })
      .overrideProvider(LogisticsResponseCampaignClient).useValue({ getCampaign: jest.fn() })
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

  it('routes versioned need changes through the command service and marks replay responses', async () => {
    const result = await request(app.getHttpServer())
      .post(`/api/v1/logistics/needs/${needId}/increase`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ expected_version: 1, quantity: '4', reason: 'Bổ sung nhu cầu.' })
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('Idempotent-Replay', 'true');

    expect(result.body).toEqual({ id: needId, requested_quantity: '4' });
    expect(commands.increase).toHaveBeenCalledWith(needId, { expected_version: 1, quantity: '4', reason: 'Bổ sung nhu cầu.' }, expect.any(Object));
  });

  it('creates a warehouse commitment through the idempotent HTTP route', async () => {
    const result = await request(app.getHttpServer())
      .post(`/api/v1/logistics/needs/${needId}/commitments`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ warehouse_id: '88888888-8888-4888-8888-888888888888', quantity: '1.25' });

    expect(result.status).toBe(201);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(commitments.create).toHaveBeenCalledWith(needId, { warehouse_id: '88888888-8888-4888-8888-888888888888', quantity: '1.25' }, expect.any(Object));
    expect(result.body).toMatchObject({ id: '99999999-9999-4999-8999-999999999999', quantity: '1.25' });
  });

  it('releases a commitment with its expected version through the idempotent HTTP route', async () => {
    const result = await request(app.getHttpServer())
      .post('/api/v1/logistics/commitments/99999999-9999-4999-8999-999999999999/release')
      .set('Idempotency-Key', idempotencyKey)
      .send({ expected_version: 2, quantity: '0.5', reason: 'Điều chỉnh phân bổ.' });

    expect(result.status).toBe(200);
    expect(result.headers['cache-control']).toBe('no-store');
    expect(result.headers['idempotent-replay']).toBe('true');
    expect(commitments.release).toHaveBeenCalledWith('99999999-9999-4999-8999-999999999999', { expected_version: 2, quantity: '0.5', reason: 'Điều chỉnh phân bổ.' }, expect.any(Object));
  });

  it('validates the release version and reason before calling the command service', async () => {
    commitments.release.mockClear();
    const result = await request(app.getHttpServer())
      .post('/api/v1/logistics/commitments/99999999-9999-4999-8999-999999999999/release')
      .set('Idempotency-Key', idempotencyKey)
      .send({ quantity: '0.5', reason: 'Điều chỉnh phân bổ.' });

    expect(result.status).toBe(400);
    expect(result.body.code).toBe('VALIDATION_FAILED');
    expect(result.body.message).toMatch(/[Ă-ưẠ-ỹ]/u);
    expect(commitments.release).not.toHaveBeenCalled();
  });

  it('serves scoped needs and fulfillment queries without caching', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/logistics/needs?request_id=${requestId}&work_cycle=2&limit=10`)
      .set('Authorization', 'Bearer actor-access-token')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect({ items: [], more: false });
    expect(queries.list.mock.calls.at(-1)?.[0]).toMatchObject({ request_id: requestId, work_cycle: 2, limit: 10 });

    await request(app.getHttpServer())
      .get(`/api/v1/logistics/requests/${requestId}/fulfillment?work_cycle=2`)
      .set('Authorization', 'Bearer actor-access-token')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(queries.fulfillment.mock.calls.at(-1)?.[0]).toBe(requestId);
  });

  it('uses the signed actor header for internal fulfillment reads', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/logistics/internal/requests/${requestId}/fulfillment?work_cycle=2`)
      .set('Authorization', 'Bearer response-service-token')
      .set('X-Actor-Authorization', 'Bearer actor-access-token')
      .expect(200)
      .expect('Cache-Control', 'no-store');

    const call = queries.fulfillment.mock.calls.at(-1);
    expect(call?.[0]).toBe(requestId);
    expect((call?.[2] as Request).headers.authorization).toBe('Bearer actor-access-token');
  });

  it('paginates need contributions through a scoped no-store route', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/logistics/needs/${needId}/contributions?limit=5`)
      .set('Authorization', 'Bearer actor-access-token')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect({ items: [], more: false });
    expect(queries.contributions.mock.calls.at(-1)?.[0]).toBe(needId);
  });
});
