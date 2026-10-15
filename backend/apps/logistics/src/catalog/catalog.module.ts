import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../../../packages/technical/src/idempotency/idempotency';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [LogisticsAuthModule],
  controllers: [CatalogController],
  providers: [CatalogService, IdempotencyService],
})
export class CatalogModule {}
