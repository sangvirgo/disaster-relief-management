import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { IdentitySessionGuard } from '../auth/auth.guard';
import { IdentityPermissionGuard, RequireIdentityPermission } from '../admin/admin-security';
import { IdentityDashboardService } from './dashboard.service';

@Controller()
export class IdentityDashboardController {
  constructor(private readonly dashboard: IdentityDashboardService) {}

  @Get('dashboard/admin')
  @UseGuards(IdentitySessionGuard, IdentityPermissionGuard)
  @RequireIdentityPermission('USER_MANAGE')
  admin(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.dashboard.admin();
  }
}
