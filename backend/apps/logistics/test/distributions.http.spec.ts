import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { Request } from 'express';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';
import { ApiExceptionFilter, loadErrorCatalog } from '../../../packages/technical/src';
import { LOGISTICS_IDENTITY_CLIENT, LOGISTICS_IDENTITY_CONFIG, LogisticsIdentityService } from '../src/auth/logistics-identity.service';
import { LOGISTICS_AUTH_CONFIG, LogisticsSessionService } from '../src/auth/logistics-session.service';
import { LogisticsServiceTokenGuard } from '../src/auth/logistics-service-token.guard';
import { AttachmentLifecycleService } from '../src/attachments/attachment-lifecycle.service';
import { ResponseCampaignModule } from '../src/integrations/response/response-campaign.module';
import { LOGISTICS_RESPONSE_CLIENT, LogisticsResponseCampaignClient, RESPONSE_CAMPAIGN_CONFIG } from '../src/integrations/response/response-campaign.client';
import { DistributionCommandsService } from '../src/distributions/distribution-commands.service';
import { DistributionQueriesService } from '../src/distributions/distribution-queries.service';
import { DistributionsModule } from '../src/distributions/distributions.module';
import { HandoffCommandsService } from '../src/distributions/handoff-commands.service';
import { HandoffAttachmentsService } from '../src/distributions/handoff-attachments.service';

const distributionId = '88888888-8888-4888-8888-888888888888';
const handoffId = '99999999-9999-4999-8999-999999999999';
const idempotencyKey = '77777777-7777-4777-8777-777777777777';

describe('Logistics distributions HTTP', () => {
  let app: INestApplication;
  const commands = {
    create: jest.fn(async (_dto: unknown, _request: Request) => ({ status: 201, value: { id: distributionId, status: 'DRAFT' }, replay: false })),
    replaceLines: jest.fn(async (_id: string, _dto: unknown, _request: Request) => ({ status: 200, value: { id: distributionId, version: 2, status: 'DRAFT' }, replay: false })),
    prepareFromCommitments: jest.fn(async (_id: string, _dto: unknown, _request: Request) => ({ status: 200, value: { id: distributionId, lines: [] }, replay: false })),
    approve: jest.fn(async (_id: string, _dto: unknown, _request: Request) => ({ status: 200, value: { id: distributionId, status: 'APPROVED' }, replay: false })),
    dispatch: jest.fn(async (_id: string, _dto: unknown, _request: Request) => ({ status: 200, value: { id: distributionId, status: 'DISPATCHED' }, replay: false })),
    cancel: jest.fn(async (_id: string, _dto: unknown, _request: Request) => ({ status: 200, value: { id: distributionId, status: 'CANCELLED' }, replay: false })),
    reconcile: jest.fn(async (_id: string, _dto: unknown, _request: Request) => ({ status: 200, value: { id: distributionId, status: 'RECONCILED' }, replay: false })),
  };
  const handoffs = {
    create: jest.fn(async (_id: string, _dto: unknown, _request: Request) => ({ status: 201, value: { id: handoffId, status: 'RECORDED' }, replay: false })),
    reviewLoss: jest.fn(async (_id: string, _handoffId: string, _dto: unknown, _request: Request) => ({ status: 200, value: { id: handoffId, decision: 'APPROVE' }, replay: false })),
  };
  const queries = {
    list: jest.fn(async () => ({ items: [], more: false })),
    detail: jest.fn(async () => ({ id: distributionId, lines: [] })),
    handoffDetail: jest.fn(async () => ({ id: handoffId, distribution_id: distributionId, evidence: [] })),
  };
  const attachments = {
    uploadHandoff: jest.fn(async () => ({ status: 201, value: { id: handoffId, state: 'READY' }, replay: false })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [DistributionsModule] })
      .overrideProvider(DistributionCommandsService).useValue(commands)
      .overrideProvider(HandoffCommandsService).useValue(handoffs)
      .overrideProvider(DistributionQueriesService).useValue(queries)
      .overrideProvider(HandoffAttachmentsService).useValue(attachments)
      .overrideProvider(AttachmentLifecycleService).useValue({})
      .overrideGuard(LogisticsServiceTokenGuard).useValue({ canActivate: () => true })
      .overrideProvider(LOGISTICS_AUTH_CONFIG).useValue({})
      .overrideProvider(LOGISTICS_IDENTITY_CONFIG).useValue({})
      .overrideProvider(LOGISTICS_IDENTITY_CLIENT).useValue({ close: () => undefined })
      .overrideProvider(LogisticsIdentityService).useValue({})
      .overrideProvider(LOGISTICS_RESPONSE_CLIENT).useValue({ close: () => undefined })
      .overrideProvider(RESPONSE_CAMPAIGN_CONFIG).useValue({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 2_000 })
      .overrideProvider(LogisticsResponseCampaignClient).useValue({})
      .overrideProvider(LogisticsSessionService).useValue({})
      .compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1/logistics');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter(loadErrorCatalog(), 'logistics'));
    await app.init();
  });

  afterAll(async () => app?.close());

  it('imports the campaign integration required by distribution commands', () => {
    expect(Reflect.getMetadata('imports', DistributionsModule)).toContain(ResponseCampaignModule);
  });

  it('creates a draft distribution through an idempotent route', async () => {
    const dto = {
      warehouse_id: distributionId,
      purpose: 'CAMPAIGN_DISTRIBUTION',
      campaign_id: distributionId,
      lines: [{ item_id: distributionId, quantity: '2.50' }],
    };
    const result = await request(app.getHttpServer())
      .post('/api/v1/logistics/distributions')
      .set('Idempotency-Key', idempotencyKey)
      .send(dto)
      .expect(201)
      .expect('Cache-Control', 'no-store');

    expect(result.body).toEqual({ id: distributionId, status: 'DRAFT' });
    expect(commands.create).toHaveBeenCalledWith(dto, expect.any(Object));
  });

  it('routes approval with the expected version and exposes replay metadata', async () => {
    commands.approve.mockImplementationOnce(async () => ({ status: 200, value: { id: distributionId, status: 'APPROVED' }, replay: true }));
    const dto = { expected_version: 3 };
    const result = await request(app.getHttpServer())
      .post(`/api/v1/logistics/distributions/${distributionId}/approve`)
      .set('Idempotency-Key', idempotencyKey)
      .send(dto)
      .expect(200)
      .expect('Idempotent-Replay', 'true');

    expect(result.body.status).toBe('APPROVED');
    expect(commands.approve).toHaveBeenCalledWith(distributionId, dto, expect.any(Object));
  });

  it('routes a handoff and independent loss review through their command services', async () => {
    const handoff = {
      handoff_kind: 'DIRECT_HOUSEHOLD',
      confirmation_basis: 'Người nhận xác nhận trực tiếp.',
      occurred_at: '2026-10-13T10:00:00.000Z',
      lines: [{ distribution_line_id: distributionId, quantity: '1' }],
    };
    await request(app.getHttpServer())
      .post(`/api/v1/logistics/distributions/${distributionId}/handoffs`)
      .set('Idempotency-Key', idempotencyKey)
      .send(handoff)
      .expect(201);
    expect(handoffs.create).toHaveBeenCalledWith(distributionId, handoff, expect.any(Object));

    const review = { expected_version: 1, decision: 'APPROVE', reason: 'Đã đối chiếu mất mát.' };
    await request(app.getHttpServer())
      .post(`/api/v1/logistics/distributions/${distributionId}/handoffs/${handoffId}/review-loss`)
      .set('Idempotency-Key', idempotencyKey)
      .send(review)
      .expect(200);
    expect(handoffs.reviewLoss).toHaveBeenCalledWith(distributionId, handoffId, review, expect.any(Object));
  });

  it('rejects client-supplied loss reviewer identity with Vietnamese validation copy', async () => {
    handoffs.reviewLoss.mockClear();
    const result = await request(app.getHttpServer())
      .post(`/api/v1/logistics/distributions/${distributionId}/handoffs/${handoffId}/review-loss`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ expected_version: 1, decision: 'APPROVE', reason: 'Đã kiểm tra.', reviewer_user_id: distributionId });

    expect(result.status).toBe(400);
    expect(result.body.code).toBe('VALIDATION_FAILED');
    expect(result.body.message).toMatch(/[Ă-ưẠ-ỹ]/u);
    expect(handoffs.reviewLoss).not.toHaveBeenCalled();
  });

  it('reads a distribution list and detail through the query service', async () => {
    await request(app.getHttpServer()).get('/api/v1/logistics/distributions?status=DRAFT').expect(200);
    await request(app.getHttpServer()).get(`/api/v1/logistics/distributions/${distributionId}`).expect(200);
    expect(queries.list).toHaveBeenCalled();
    expect(queries.detail).toHaveBeenCalledWith(distributionId, expect.any(Object));
  });

  it('reads scoped handoff detail through the query service', async () => {
    const result = await request(app.getHttpServer())
      .get(`/api/v1/logistics/distributions/${distributionId}/handoffs/${handoffId}`)
      .expect(200)
      .expect('Cache-Control', 'no-store');

    expect(result.body).toEqual({ id: handoffId, distribution_id: distributionId, evidence: [] });
    expect(queries.handoffDetail).toHaveBeenCalledWith(distributionId, handoffId, expect.any(Object));
  });

  it('routes nested handoff evidence upload through the shared attachment service', async () => {
    const result = await request(app.getHttpServer())
      .post(`/api/v1/logistics/distributions/${distributionId}/handoffs/${handoffId}/evidence`)
      .set('Idempotency-Key', idempotencyKey)
      .attach('file', Buffer.from('test-evidence'), { filename: 'evidence.png', contentType: 'image/png' })
      .expect(201)
      .expect('Cache-Control', 'no-store');

    expect(result.body).toEqual({ id: handoffId, state: 'READY' });
    expect(attachments.uploadHandoff).toHaveBeenCalledWith(distributionId, handoffId, expect.any(Object));
  });

  it('rejects a distribution page size above the API maximum', async () => {
    queries.list.mockClear();
    const result = await request(app.getHttpServer())
      .get('/api/v1/logistics/distributions?limit=101');

    expect(result.status).toBe(400);
    expect(result.body.code).toBe('VALIDATION_FAILED');
    expect(result.body.message).toMatch(/[Ă-ỹ]/u);
    expect(queries.list).not.toHaveBeenCalled();
  });
});
