import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ReportSummaryQueryDto } from './reports.dto';
import { ReportsService } from './reports.service';

@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports/summary')
  summary(
    @Query() query: ReportSummaryQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    response.setHeader('Cache-Control', 'no-store');
    return this.reports.summary(query, request);
  }
}
