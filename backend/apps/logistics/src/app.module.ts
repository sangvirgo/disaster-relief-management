import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule, postgresOptions } from '../../../packages/technical/src';
import { AssetsModule } from './assets/assets.module';
import { CatalogModule } from './catalog/catalog.module';
import { InitialLogistics1710000000000 } from './database/migrations/InitialLogistics1710000000000';
import { ReceiptsModule } from './receipts/receipts.module';
import { StockModule } from './stock/stock.module';
import { DrivesModule } from './drives/drives.module';
import { NeedsModule } from './needs/needs.module';
import { DistributionsModule } from './distributions/distributions.module';
import { FulfillmentCyclesModule } from './fulfillment-cycles/fulfillment-cycles.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(postgresOptions([InitialLogistics1710000000000], 'logistics')),
    HealthModule,
    CatalogModule,
    AssetsModule,
    StockModule,
    DrivesModule,
    NeedsModule,
    DistributionsModule,
    FulfillmentCyclesModule,
    ReceiptsModule,
  ],
})
export class AppModule {}
