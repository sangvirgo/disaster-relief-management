import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DonationReportService } from './donation-report.service';
import { FulfillmentReportService } from './fulfillment-report.service';
import {
  FulfillmentReportQueryDto, PublicDonationReportQueryDto, ReconciliationQueryDto, StockSummaryQueryDto,
} from './reports.dto';
import { ReconciliationReportService } from './reconciliation-report.service';
import { StockReportService } from './stock-report.service';
import { DriveSuggestionsService } from './drive-suggestions.service';
import { OperationsDashboardService } from './operations-dashboard.service';
import { noStore } from '@c48/technical/http/response-headers';

@Controller()
export class ReportsController {
  constructor(
    private readonly stock: StockReportService,
    private readonly fulfillment: FulfillmentReportService,
    private readonly donations: DonationReportService,
    private readonly reconciliation: ReconciliationReportService,
    private readonly driveSuggestions: DriveSuggestionsService,
    private readonly operationsDashboard: OperationsDashboardService,
  ) {}

  @Get('dashboard/operations')
  operations(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.operationsDashboard.overview(request);
  }

  @Get('reports/drive-suggestions')
  suggestDrives(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.driveSuggestions.suggestions(request);
  }

  @Get('reports/stock-summary')
  stockSummary(
    @Query() query: StockSummaryQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.stock.summary(query, request);
  }

  @Get('reports/fulfillment')
  fulfillmentSummary(
    @Query() query: FulfillmentReportQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.fulfillment.summary(query, request);
  }

  @Get('public/donation-reports/summary')
  publicDonationSummary(
    @Query() query: PublicDonationReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.donations.summary(query);
  }

  @Get('reconciliation')
  reconciliationSummary(
    @Query() query: ReconciliationQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    return this.reconciliation.summary(query, request);
  }
}
