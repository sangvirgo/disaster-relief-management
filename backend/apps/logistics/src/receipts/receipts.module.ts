import { Module } from '@nestjs/common';
import { IdempotencyService } from '../../../../packages/technical/src/idempotency/idempotency';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { DonationReceiptsController } from './donation-receipts.controller';
import { DonationReceiptsQueriesService } from './donation-receipts-queries.service';
import { DonationReceiptsService } from './donation-receipts.service';

@Module({
  imports: [LogisticsAuthModule],
  controllers: [DonationReceiptsController],
  providers: [IdempotencyService, DonationReceiptsService, DonationReceiptsQueriesService],
})
export class ReceiptsModule {}
