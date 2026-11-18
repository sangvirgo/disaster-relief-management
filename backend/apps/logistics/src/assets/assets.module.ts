import { Module } from '@nestjs/common';
import { IdempotencyService } from '@c48/technical/idempotency/idempotency';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { CampaignWarehouseModule } from '../campaign-warehouses/campaign-warehouses.module';
import { AssetsController } from './assets.controller';
import { AssetsQueriesService } from './assets-queries.service';
import { AssetsService } from './assets.service';

@Module({
  imports: [LogisticsAuthModule, CampaignWarehouseModule],
  controllers: [AssetsController],
  providers: [AssetsService, AssetsQueriesService, IdempotencyService],
})
export class AssetsModule {}
