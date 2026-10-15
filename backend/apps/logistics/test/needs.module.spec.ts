import { resolve } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { jest } from '@jest/globals';
import { AppModule } from '../src/app.module';
import { ResponseCampaignModule } from '../src/integrations/response/response-campaign.module';
import { NeedCommitmentsService } from '../src/needs/need-commitments.service';
import { NeedsController } from '../src/needs/needs.controller';
import { NeedsModule } from '../src/needs/needs.module';

const dataSourceToken = getDataSourceToken();

@Global()
@Module({
  providers: [{ provide: dataSourceToken, useValue: { query: jest.fn(), transaction: jest.fn() } }],
  exports: [dataSourceToken],
})
class TestDataSourceModule {}

describe('NeedsModule registration', () => {
  it('is part of the Logistics application and owns the needs controller', async () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.DATABASE_URL = 'postgres://logistics_app_login:unit-only@127.0.0.1:55432/c48_logistics';
    process.env.NODE_ENV = 'test';
    const { AppModule } = await import('../src/app.module');
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;

    expect(Reflect.getMetadata('imports', AppModule)).toContain(NeedsModule);
    expect(Reflect.getMetadata('controllers', NeedsModule)).toContain(NeedsController);
    expect(Reflect.getMetadata('imports', NeedsModule)).toContain(ResponseCampaignModule);
    expect(Reflect.getMetadata('providers', NeedsModule)).toContain(NeedCommitmentsService);
  });

  it('resolves the real commitments provider graph', async () => {
    const overrides: Record<string, string> = {
      NODE_ENV: 'test',
      JWT_ISSUER: 'https://c48.test',
      JWT_AUDIENCE: 'c48-test',
      JWT_PUBLIC_KEY_FILE: resolve(process.cwd(), 'test/fixtures/response-test-public.pem'),
      WEB_ALLOWED_ORIGINS: 'https://c48.test',
      IDENTITY_BASE_URL: 'http://identity-api:3001',
      LOGISTICS_SERVICE_CLIENT_ID: 'c48-logistics-test',
      LOGISTICS_SERVICE_CLIENT_SECRET: 'c48-test-logistics-secret-not-for-deployment-0001',
      INTROSPECT_TIMEOUT_MS: '500',
      RESPONSE_BASE_URL: 'http://response-api:3002',
    };
    const previous = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]));
    for (const [key, value] of Object.entries(overrides)) process.env[key] = value;

    try {
      const moduleRef = await Test.createTestingModule({ imports: [TestDataSourceModule, NeedsModule] }).compile();

      expect(moduleRef.get(NeedCommitmentsService)).toBeInstanceOf(NeedCommitmentsService);
      await moduleRef.close();
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
