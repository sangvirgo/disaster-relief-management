import { resolve } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { jest } from '@jest/globals';
import { AuditController } from '../src/audit/audit.controller';
import { AuditModule } from '../src/audit/audit.module';
import { AuditService } from '../src/audit/audit.service';
import { ReportsController } from '../src/reports/reports.controller';
import { DonationReportService } from '../src/reports/donation-report.service';
import { FulfillmentReportService } from '../src/reports/fulfillment-report.service';
import { ReconciliationReportService } from '../src/reports/reconciliation-report.service';
import { ReportsModule } from '../src/reports/reports.module';
import { StockReportService } from '../src/reports/stock-report.service';

const dataSourceToken = getDataSourceToken();

@Global()
@Module({
  providers: [{ provide: dataSourceToken, useValue: { query: jest.fn() } }],
  exports: [dataSourceToken],
})
class TestDataSourceModule {}

describe('ReportsModule', () => {
  it('registers documented report and audit endpoints with their providers', async () => {
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
    };
    const previous = new Map(Object.keys(overrides).map((key) => [key, process.env[key]]));
    for (const [key, value] of Object.entries(overrides)) process.env[key] = value;

    try {
      const { AppModule } = await import('../src/app.module');
      const moduleRef = await Test.createTestingModule({ imports: [TestDataSourceModule, ReportsModule, AuditModule] }).compile();

      expect(Reflect.getMetadata('imports', AppModule)).toContain(ReportsModule);
      expect(Reflect.getMetadata('imports', AppModule)).toContain(AuditModule);
      expect(Reflect.getMetadata('controllers', ReportsModule)).toContain(ReportsController);
      expect(moduleRef.get(StockReportService)).toBeInstanceOf(StockReportService);
      expect(moduleRef.get(FulfillmentReportService)).toBeInstanceOf(FulfillmentReportService);
      expect(moduleRef.get(DonationReportService)).toBeInstanceOf(DonationReportService);
      expect(moduleRef.get(ReconciliationReportService)).toBeInstanceOf(ReconciliationReportService);
      expect(Reflect.getMetadata('controllers', AuditModule)).toContain(AuditController);
      expect(moduleRef.get(AuditService)).toBeInstanceOf(AuditService);
      await moduleRef.close();
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
