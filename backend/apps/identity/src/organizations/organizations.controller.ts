import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { AuthTransportGuard, IdentitySessionGuard } from '../auth/auth.guard';
import { AdminRequest, IdentityPermissionGuard, RequireIdentityPermission } from '../admin/admin-security';
import { AddMemberDto, CreateOrganizationDto, OrganizationActionDto, OrganizationListQueryDto } from './organizations.dto';
import { OrganizationsService } from './organizations.service';

@Controller()
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get('organizations')
  @UseGuards(IdentitySessionGuard, IdentityPermissionGuard)
  @RequireIdentityPermission('ORG_MANAGE')
  list(@Query() query: OrganizationListQueryDto) { return this.organizations.list(query); }

  @Post('organizations')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(IdentitySessionGuard, AuthTransportGuard, IdentityPermissionGuard)
  @UseInterceptors(IdempotencyKeyInterceptor)
  @RequireIdentityPermission('ORG_MANAGE')
  async create(@Body() dto: CreateOrganizationDto, @Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.organizations.create(dto, request);
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }

  @Post('organizations/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IdentitySessionGuard, AuthTransportGuard, IdentityPermissionGuard)
  @UseInterceptors(IdempotencyKeyInterceptor)
  @RequireIdentityPermission('ORG_MANAGE')
  async deactivate(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: OrganizationActionDto, @Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.organizations.deactivate(id, dto, request);
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }

  @Post('organizations/:id/members')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(IdentitySessionGuard, AuthTransportGuard, IdentityPermissionGuard)
  @UseInterceptors(IdempotencyKeyInterceptor)
  @RequireIdentityPermission('ORG_MANAGE')
  async addMember(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: AddMemberDto, @Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.organizations.addMember(id, dto, request);
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }

  @Post('organizations/:id/members/:userId/remove')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(IdentitySessionGuard, AuthTransportGuard, IdentityPermissionGuard)
  @UseInterceptors(IdempotencyKeyInterceptor)
  @RequireIdentityPermission('ORG_MANAGE')
  async removeMember(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Param('userId', new ParseUUIDPipe({ version: 'all' })) userId: string, @Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.organizations.removeMember(id, userId, request);
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
  }
}
