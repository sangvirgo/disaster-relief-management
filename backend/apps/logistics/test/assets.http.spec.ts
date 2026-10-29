import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import request from 'supertest';
import { IdempotencyKeyInterceptor } from '@c48/technical/idempotency/idempotency.interceptor';
import { AssetsController } from '../src/assets/assets.controller';
import { AssetsQueriesService } from '../src/assets/assets-queries.service';
import { AssetsService } from '../src/assets/assets.service';

const assetId = '33333333-3333-4333-8333-333333333333';
const idempotencyKey = '66666666-6666-4666-8666-666666666666';

describe('asset deactivation HTTP status', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const assets = {
      deactivate: jest.fn(async () => ({ status: 200, value: { id: assetId, status: 'INACTIVE' }, replay: false })),
    };
    const module = await Test.createTestingModule({
      controllers: [AssetsController],
      providers: [
        { provide: AssetsService, useValue: assets },
        { provide: AssetsQueriesService, useValue: {} },
        IdempotencyKeyInterceptor,
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1/logistics');
    await app.init();
  });

  afterAll(async () => app?.close());

  it.each([
    '/warehouses',
    '/relief-points',
    '/vehicles',
  ])('returns HTTP 200 for POST %s/:id/deactivate', async (path) => {
    await request(app.getHttpServer())
      .post(`/api/v1/logistics${path}/${assetId}/deactivate`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ expected_version: 1 })
      .expect(200);
  });
});
