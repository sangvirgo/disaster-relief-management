import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../../../packages/technical/src/idempotency/idempotency';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { StockController } from './stock.controller';
import { StockQueriesService } from './stock-queries.service';
import { StockService } from './stock.service';

@Module({
  imports: [LogisticsAuthModule],
  controllers: [StockController],
  providers: [StockService, StockQueriesService, IdempotencyService],
})
export class StockModule {}
