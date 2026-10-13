import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';
import { ApiExceptionFilter, loadErrorCatalog } from '../../../packages/technical/src';
import { LogisticsServiceTokenGuard } from '../src/resolution/logistics-service-token.guard';
import { RequestResolutionController } from '../src/resolution/request-resolution.controller';
import { RequestResolutionLifecycleService } from '../src/resolution/request-resolution-lifecycle.service';
import { RequestResolutionStateService } from '../src/resolution/request-resolution-state.service';
import { RequestResolutionService } from '../src/resolution/request-resolution.service';

const requestId = '40000000-0000-4000-8000-000000000001';
const operationId = '50000000-0000-4000-8000-000000000001';
const key = '80000000-0000-4000-8000-000000000001';

describe('RequestResolutionController HTTP', () => {
  let app: INestApplication;
  const resolutions = {
    resolve: jest.fn(async () => ({ status: 202, replay: false, value: { operation_id: operationId, state: 'PENDING' } })),
    operation: jest.fn(async () => ({ operation_id: operationId, state: 'COMPLETED' })),
    internalOperation: jest.fn(async () => ({
      id: operationId, kind: 'RESOLUTION', state: 'PENDING', request_id: requestId, work_cycle: 2,
      request_status: 'RESOLVING', organization_id: '70000000-0000-4000-8000-000000000001',
      region_code: 'DEMO_A', campaign_id: null, outcome_basis: 'RESCUE_COMPLETED',
    })),
  };
  const lifecycle = {
    cancel: jest.fn(async () => ({ status: 202, replay: true, value: { operation_id: operationId, state: 'COMPLETED' } })),
    abortForRequest: jest.fn(async () => ({ status: 202, replay: false, value: { operation_id: operationId, state: 'ABORTING' } })),
    abortOperation: jest.fn(async () => ({ status: 202, replay: false, value: { operation_id: operationId, state: 'ABORTING' } })),
    adopt: jest.fn(async () => ({ status: 202, replay: false, value: { operation_id: operationId, state: 'PENDING' } })),
  };
  const state = {
    close: jest.fn(async () => ({ status: 200, replay: false, value: { id: requestId, status: 'CLOSED', version: 2 } })),
    reopen: jest.fn(async () => ({ status: 200, replay: false, value: { id: requestId, status: 'TRIAGED', version: 3 } })),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [RequestResolutionController],
      providers: [
        { provide: RequestResolutionService, useValue: resolutions },
        { provide: RequestResolutionLifecycleService, useValue: lifecycle },
        { provide: RequestResolutionStateService, useValue: state },
      ],
    }).overrideGuard(LogisticsServiceTokenGuard).useValue({ canActivate: () => true }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1/response');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ApiExceptionFilter(loadErrorCatalog(), 'response'));
    await app.init();
  });

  afterAll(async () => app.close());

  it('routes cancel and operation adoption with idempotency and no-store headers', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/response/requests/${requestId}/cancel`)
      .set('Idempotency-Key', key)
      .send({ expected_version: 7, reason: 'Không còn nhu cầu' })
      .expect(202)
      .expect('cache-control', 'no-store')
      .expect('idempotent-replay', 'true')
      .expect(({ body }) => expect(body).toEqual({ operation_id: operationId, state: 'COMPLETED' }));
    await request(app.getHttpServer())
      .post(`/api/v1/response/operations/${operationId}/adopt`)
      .set('Idempotency-Key', key)
      .send({ expected_version: 8, reason: 'Tiếp nhận xử lý' })
      .expect(202)
      .expect('cache-control', 'no-store');
    expect(lifecycle.cancel).toHaveBeenCalledWith(requestId, { expected_version: 7, reason: 'Không còn nhu cầu' }, key, expect.any(Object));
    expect(lifecycle.adopt).toHaveBeenCalledWith(operationId, { expected_version: 8, reason: 'Tiếp nhận xử lý' }, key, expect.any(Object));
  });

  it('exposes the full Logistics intent precheck projection behind the internal route', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/response/internal/operations/${operationId}`)
      .expect(200)
      .expect('cache-control', 'no-store')
      .expect(({ body }) => expect(body).toMatchObject({
        id: operationId, request_id: requestId, work_cycle: 2, state: 'PENDING', outcome_basis: 'RESCUE_COMPLETED',
      }));
    expect(resolutions.internalOperation).toHaveBeenCalledWith(operationId);
  });

  it('routes close and reopen as versioned 200 commands', async () => {
    await request(app.getHttpServer()).post(`/api/v1/response/requests/${requestId}/close`)
      .set('Idempotency-Key', key).send({ expected_version: 1 }).expect(200);
    await request(app.getHttpServer()).post(`/api/v1/response/requests/${requestId}/reopen`)
      .set('Idempotency-Key', key).send({ expected_version: 2, reason: 'Cần xử lý lại' }).expect(200);
    expect(state.close).toHaveBeenCalled();
    expect(state.reopen).toHaveBeenCalled();
  });
});
