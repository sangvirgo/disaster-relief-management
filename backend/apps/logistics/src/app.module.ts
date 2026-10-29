import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule, postgresOptions } from '@c48/technical';
import { AssetsModule } from './assets/assets.module';
import { AuditModule } from './audit/audit.module';
import { CatalogModule } from './catalog/catalog.module';
import { InitialLogistics1710000000000 } from './database/migrations/InitialLogistics1710000000000';
import { ReceiptsModule } from './receipts/receipts.module';
import { StockModule } from './stock/stock.module';
import { NeedsModule } from './needs/needs.module';
import { EvidenceModule } from './evidence/evidence.module';
import { FulfillmentCyclesModule } from './fulfillment-cycles/fulfillment-cycles.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(postgresOptions([InitialLogistics1710000000000], 'logistics')),
    HealthModule,
    CatalogModule,
    AssetsModule,
    StockModule,
    EvidenceModule,
    NeedsModule,
    FulfillmentCyclesModule,
    ReceiptsModule,
    ReportsModule,
    AuditModule,
  ],
})
export class AppModule {}
