import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { noStore } from '@c48/technical/http/response-headers';
import { DashboardService } from './dashboard.service';

@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Coordinators see their organization/region scope; administrators see the whole system. */
  @Get('dashboard/overview')
  overview(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.dashboard.overview(request);
  }
}
