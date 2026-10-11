import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { InternalService } from './internal.service';
import { IntrospectDto, LookupUsersDto, RequestCoordinatorQueryDto, ServiceTokenDto, TeamLeaderEligibilityDto } from './internal.dto';
import { AdminRequest, IdentityServiceGuard } from '../admin/admin-security';

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

@Controller('internal')
export class InternalController {
  constructor(private readonly internalService: InternalService) {}

  @Post('token')
  @HttpCode(HttpStatus.OK)
  token(@Body() dto: ServiceTokenDto, @Res({ passthrough: true }) response: Response): Record<string, unknown> {
    noStore(response);
    return this.internalService.issueToken(dto);
  }

  @Post('introspect')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IdentityServiceGuard)
  async introspect(@Body() dto: IntrospectDto, @Res({ passthrough: true }) response: Response): Promise<Record<string, unknown>> {
    noStore(response);
    return this.internalService.introspect(dto);
  }

  @Post('users\\:lookup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IdentityServiceGuard)
  async lookupUsers(@Body() dto: LookupUsersDto, @Res({ passthrough: true }) response: Response): Promise<Record<string, unknown>> {
    noStore(response);
    return this.internalService.lookupUsers(dto.ids);
  }

  @Post('team-leader-eligibility')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IdentityServiceGuard)
  async teamLeaderEligibility(
    @Body() dto: TeamLeaderEligibilityDto,
    @Req() request: AdminRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    if (request.serviceCaller !== 'response') throw new AppError('FORBIDDEN', { status: 403 });
    return this.internalService.teamLeaderEligibility(dto.user_id, dto.organization_id);
  }

  @Post('request-coordinators')
  @HttpCode(HttpStatus.OK)
  @UseGuards(IdentityServiceGuard)
  async requestCoordinators(
    @Body() dto: RequestCoordinatorQueryDto,
    @Req() request: Request & { serviceCaller?: string },
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    noStore(response);
    if (request.serviceCaller !== 'response') throw new AppError('FORBIDDEN', { status: 403 });
    return this.internalService.requestCoordinators(dto.organization_id);
  }

  @Get('organizations/:id')
  @UseGuards(IdentityServiceGuard)
  async organization(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Res({ passthrough: true }) response: Response): Promise<Record<string, unknown>> {
    noStore(response);
    return this.internalService.organization(id);
  }
}
