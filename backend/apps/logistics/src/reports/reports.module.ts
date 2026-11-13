import { Module } from '@nestjs/common';
import { LogisticsAuthModule } from '../auth/logistics-auth.module';
import { DonationReportService } from './donation-report.service';
import { FulfillmentReportService } from './fulfillment-report.service';
import { ReconciliationReportService } from './reconciliation-report.service';
import { ReportsController } from './reports.controller';
import { StockReportService } from './stock-report.service';
import { DriveSuggestionsService } from './drive-suggestions.service';
import { OperationsDashboardService } from './operations-dashboard.service';

@Module({
  imports: [LogisticsAuthModule],
  controllers: [ReportsController],
  providers: [StockReportService, FulfillmentReportService, DonationReportService, ReconciliationReportService, DriveSuggestionsService, OperationsDashboardService],
})
export class ReportsModule {}
