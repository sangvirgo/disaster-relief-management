import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IdentitySessionGuard } from '../auth/auth.guard';
import { IdentityPermissionGuard, RequireIdentityPermission } from '../admin/admin-security';
import { AuditListQueryDto } from './audit.dto';
import { AuditService } from './audit.service';

@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('audit-logs')
  @UseGuards(IdentitySessionGuard, IdentityPermissionGuard)
  @RequireIdentityPermission('AUDIT_READ')
  list(@Query() query: AuditListQueryDto) { return this.audit.list(query); }
}
