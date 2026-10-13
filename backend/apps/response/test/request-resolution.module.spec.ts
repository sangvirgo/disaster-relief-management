import { generateKeyPairSync } from 'node:crypto';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { jest } from '@jest/globals';
import { RequestResolutionController } from '../src/resolution/request-resolution.controller';
import { RequestFailureReviewService } from '../src/resolution/request-failure-review.service';
import { RequestResolutionFinalizer } from '../src/resolution/request-resolution-finalizer.service';
import { RequestResolutionLifecycleService } from '../src/resolution/request-resolution-lifecycle.service';
import { RequestResolutionModule } from '../src/resolution/request-resolution.module';
import { RequestResolutionRecoveryService } from '../src/resolution/request-resolution-recovery.service';
import { RequestResolutionService } from '../src/resolution/request-resolution.service';
import { RequestResolutionStateService } from '../src/resolution/request-resolution-state.service';

const dataSourceToken = getDataSourceToken();

@Global()
@Module({
  providers: [{ provide: dataSourceToken, useValue: { query: jest.fn(), transaction: jest.fn(), createQueryRunner: jest.fn() } }],
  exports: [dataSourceToken],
})
class TestDataSourceModule {}

describe('RequestResolutionModule registration', () => {
  it('resolves the lifecycle, recovery, state, and failure-review providers from the feature module', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
    const overrides: Record<string, string> = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://response_app_login:unit-only@127.0.0.1:55432/c48_response',
      JWT_ISSUER: 'https://identity.test',
      JWT_AUDIENCE: 'c48-response-test',
      JWT_PUBLIC_KEY: Buffer.from(publicKey.export({ type: 'spki', format: 'pem' }).toString()).toString('base64'),
      WEB_ALLOWED_ORIGINS: 'http://localhost:3000',
      DEMO_INTAKE_ORGANIZATION_ID: '40000000-0000-4000-8000-000000000004',
      SECRET_HASH_PEPPER_SOS: 's'.repeat(40),
      IDENTITY_BASE_URL: 'http://identity:3001',
      RESPONSE_SERVICE_CLIENT_ID: 'c48-response-test',
      RESPONSE_SERVICE_CLIENT_SECRET: 'c48-test-response-secret-not-for-deployment-0001',
      LOGISTICS_BASE_URL: 'http://logistics:3003',
      INTROSPECT_TIMEOUT_MS: '500',
    };
    const previous = new Map(Object.keys(overrides).map((name) => [name, process.env[name]]));
    for (const [name, value] of Object.entries(overrides)) process.env[name] = value;

    try {
      const moduleRef = await Test.createTestingModule({ imports: [TestDataSourceModule, RequestResolutionModule] }).compile();
      expect(moduleRef.get(RequestResolutionController)).toBeInstanceOf(RequestResolutionController);
      expect(moduleRef.get(RequestResolutionService)).toBeInstanceOf(RequestResolutionService);
      expect(moduleRef.get(RequestResolutionLifecycleService)).toBeInstanceOf(RequestResolutionLifecycleService);
      expect(moduleRef.get(RequestResolutionStateService)).toBeInstanceOf(RequestResolutionStateService);
      expect(moduleRef.get(RequestFailureReviewService)).toBeInstanceOf(RequestFailureReviewService);
      expect(moduleRef.get(RequestResolutionRecoveryService)).toBeInstanceOf(RequestResolutionRecoveryService);
      expect(Reflect.getMetadata('exports', RequestResolutionModule)).toContain(RequestFailureReviewService);
      await moduleRef.close();
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
