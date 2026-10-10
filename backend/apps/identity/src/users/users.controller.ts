import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency.interceptor';
import { AuthTransportGuard, IdentitySessionGuard } from '../auth/auth.guard';
import { AdminRequest, IdentityPermissionGuard, RequireIdentityPermission } from '../admin/admin-security';
import { CreateUserDto, ResetPasswordDto, UserListQueryDto, UserVersionActionDto } from './users.dto';
import { UsersService } from './users.service';

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('users')
  @UseGuards(IdentitySessionGuard, IdentityPermissionGuard)
  @RequireIdentityPermission('USER_MANAGE')
  list(@Query() query: UserListQueryDto) { return this.users.list(query); }

  @Get('users/:id')
  @UseGuards(IdentitySessionGuard, IdentityPermissionGuard)
  @RequireIdentityPermission('USER_MANAGE')
  get(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string) { return this.users.get(id); }

  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(IdentitySessionGuard, AuthTransportGuard, IdentityPermissionGuard)
  @UseInterceptors(IdempotencyKeyInterceptor)
  @RequireIdentityPermission('USER_MANAGE')
  async create(@Body() dto: CreateUserDto, @Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.users.create(dto, request);
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }

  @Post('users/:id/disable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IdentitySessionGuard, AuthTransportGuard, IdentityPermissionGuard)
  @UseInterceptors(IdempotencyKeyInterceptor)
  @RequireIdentityPermission('USER_MANAGE')
  async disable(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: UserVersionActionDto, @Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.users.setStatus(id, 'disable', dto, request);
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }

  @Post('users/:id/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IdentitySessionGuard, AuthTransportGuard, IdentityPermissionGuard)
  @UseInterceptors(IdempotencyKeyInterceptor)
  @RequireIdentityPermission('USER_MANAGE')
  async enable(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: UserVersionActionDto, @Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.users.setStatus(id, 'enable', dto, request);
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    return result.value;
  }

  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(IdentitySessionGuard, AuthTransportGuard, IdentityPermissionGuard)
  @UseInterceptors(IdempotencyKeyInterceptor)
  @RequireIdentityPermission('USER_MANAGE')
  async resetPassword(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: ResetPasswordDto, @Req() request: AdminRequest, @Res({ passthrough: true }) response: Response) {
    const result = await this.users.resetPassword(id, dto, request);
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
  }
}
