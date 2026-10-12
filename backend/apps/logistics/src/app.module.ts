import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthModule, postgresOptions } from '../../../packages/technical/src';
import { AssetsModule } from './assets/assets.module';
import { CatalogModule } from './catalog/catalog.module';
import { InitialLogistics1710000000000 } from './database/migrations/InitialLogistics1710000000000';
import { StockModule } from './stock/stock.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(postgresOptions([InitialLogistics1710000000000], 'logistics')),
    HealthModule,
    CatalogModule,
    AssetsModule,
    StockModule,
  ],
})
export class AppModule {}
