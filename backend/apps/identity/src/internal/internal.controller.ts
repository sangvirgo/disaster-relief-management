import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { InternalService } from './internal.service';
import { IntrospectDto, LookupUsersDto, ServiceTokenDto } from './internal.dto';
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

  @Get('organizations/:id')
  @UseGuards(IdentityServiceGuard)
  async organization(@Param('id') id: string, @Res({ passthrough: true }) response: Response): Promise<Record<string, unknown>> {
    noStore(response);
    return this.internalService.organization(id);
  }
}
