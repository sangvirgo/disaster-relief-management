import { INestApplication } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { HealthController } from '../src/health.controller';

describe('health endpoints', () => {
  const query = jest.fn<() => Promise<unknown>>();
  const dataSource = { query };
  let app: INestApplication;

  beforeEach(async () => {
    query.mockReset();
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: DataSource, useValue: dataSource }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('reports liveness without exposing dependency details', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
    expect(query).not.toHaveBeenCalled();
  });

  it('reports readiness and hides database errors', async () => {
    query.mockResolvedValueOnce([]);
    await request(app.getHttpServer()).get('/health/ready').expect(200, { status: 'ok' });

    query.mockRejectedValueOnce(new Error('private database detail'));
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503, { status: 'unavailable' });
    expect(JSON.stringify(response.body)).not.toContain('private database detail');
  });
});
