import { resolve } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { jest } from '@jest/globals';
import { FulfillmentCyclesService } from '../src/fulfillment-cycles/fulfillment-cycles.service';
import { FulfillmentCyclesController } from '../src/fulfillment-cycles/fulfillment-cycles.controller';
import { FulfillmentCyclesModule } from '../src/fulfillment-cycles/fulfillment-cycles.module';
import { ResponseCycleIntentClient } from '../src/integrations/response/response-cycle-intent.client';

const dataSourceToken = getDataSourceToken();

@Global()
@Module({
  providers: [{ provide: dataSourceToken, useValue: { query: jest.fn(), transaction: jest.fn() } }],
  exports: [dataSourceToken],
})
class TestDataSourceModule {}

describe('FulfillmentCyclesModule registration', () => {
  it('registers the internal controller and resolves its Logistics-to-Response provider graph', async () => {
    const overrides: Record<string, string> = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://logistics_app_login:unit-only@127.0.0.1:55432/c48_logistics',
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
      const { AppModule } = await import('../src/app.module');
      expect(Reflect.getMetadata('imports', AppModule)).toContain(FulfillmentCyclesModule);
      expect(Reflect.getMetadata('controllers', FulfillmentCyclesModule)).toContain(FulfillmentCyclesController);

      const moduleRef = await Test.createTestingModule({ imports: [TestDataSourceModule, FulfillmentCyclesModule] }).compile();
      expect(moduleRef.get(FulfillmentCyclesService)).toBeInstanceOf(FulfillmentCyclesService);
      expect(moduleRef.get(ResponseCycleIntentClient)).toBeInstanceOf(ResponseCycleIntentClient);
      await moduleRef.close();
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
