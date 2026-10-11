import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { AuthTransportGuard, IdentitySessionGuard } from '../auth/auth.guard';
import { AdminRequest, IdentityPermissionGuard, RequireIdentityPermission } from '../admin/admin-security';
import { CreateRegionDto, DeactivateRegionDto, RegionListQueryDto } from './regions.dto';
import { RegionsService } from './regions.service';

@Controller()
export class RegionsController {
  constructor(private readonly regions: RegionsService) {}

  @Get('regions')
  @UseGuards(IdentitySessionGuard)
  list(@Query() query: RegionListQueryDto) { return this.regions.list(query); }

  @Post('regions')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(IdentitySessionGuard, AuthTransportGuard, IdentityPermissionGuard)
  @UseInterceptors(IdempotencyKeyInterceptor)
  @RequireIdentityPermission('USER_MANAGE')
  async create(@Body() dto: CreateRegionDto, @Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.regions.create(dto, request);
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }

  @Post('regions/:code/deactivate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IdentitySessionGuard, AuthTransportGuard, IdentityPermissionGuard)
  @UseInterceptors(IdempotencyKeyInterceptor)
  @RequireIdentityPermission('USER_MANAGE')
  async deactivate(@Param('code') code: string, @Body() dto: DeactivateRegionDto, @Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.regions.deactivate(code, dto, request);
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }
}
