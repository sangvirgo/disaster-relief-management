import { Module } from '@nestjs/common';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { DonationReportService } from './donation-report.service';
import { FulfillmentReportService } from './fulfillment-report.service';
import { ReconciliationReportService } from './reconciliation-report.service';
import { ReportsController } from './reports.controller';
import { StockReportService } from './stock-report.service';

@Module({
  imports: [LogisticsAuthModule],
  controllers: [ReportsController],
  providers: [StockReportService, FulfillmentReportService, DonationReportService, ReconciliationReportService],
})
export class ReportsModule {}
