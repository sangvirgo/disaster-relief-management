import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { IdempotencyKeyInterceptor } from '@c48/technical/idempotency/idempotency.interceptor';
import { AuthTransportGuard, IdentitySessionGuard } from '../auth/auth.guard';
import { AdminRequest, IdentityPermissionGuard, RequireIdentityPermission } from '../admin/admin-security';
import { CreateGrantDto, GrantListQueryDto, RevokeGrantDto } from './grants.dto';
import { GrantsService } from './grants.service';

@Controller()
export class GrantsController {
  constructor(private readonly grants: GrantsService) {}

  @Get('users/:id/grants')
  @UseGuards(IdentitySessionGuard, IdentityPermissionGuard)
  @RequireIdentityPermission('GRANT_MANAGE')
  list(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Query() query: GrantListQueryDto) {
    return this.grants.list(id, query);
  }

  @Post('users/:id/grants')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(IdentitySessionGuard, AuthTransportGuard, IdentityPermissionGuard)
  @UseInterceptors(IdempotencyKeyInterceptor)
  @RequireIdentityPermission('GRANT_MANAGE')
  async create(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: CreateGrantDto, @Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.grants.create(id, dto, request);
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }

  @Post('grants/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IdentitySessionGuard, AuthTransportGuard, IdentityPermissionGuard)
  @UseInterceptors(IdempotencyKeyInterceptor)
  @RequireIdentityPermission('GRANT_MANAGE')
  async revoke(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: RevokeGrantDto, @Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.grants.revoke(id, dto, request);
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }
}
