import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditListQueryDto } from './audit.dto';
import { AuditService } from './audit.service';

@Controller()
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('audit-logs')
  list(
    @Query() query: AuditListQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return this.audit.list(query, request);
  }
}
