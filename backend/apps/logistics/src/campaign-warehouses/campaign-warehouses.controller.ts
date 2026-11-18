import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Req, Res, UseInterceptors,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { IdempotencyKeyInterceptor } from '@c48/technical/idempotency/idempotency.interceptor';
import { noStore, markIdempotentReplay as replay } from '@c48/technical/http/response-headers';
import { CampaignWarehouseService } from './campaign-warehouses.service';
import { ReevaluateCampaignWarehousesDto, SetPrimaryWarehouseDto } from './campaign-warehouses.dto';

type AssignmentRequest = Request & { idempotencyKey?: string };

@Controller()
export class CampaignWarehousesController {
  constructor(private readonly assignments: CampaignWarehouseService) {}

  @Get('campaigns/:id/warehouses')
  list(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.assignments.list(id, request);
  }

  @Put('campaigns/:id/primary-warehouse')
  @UseInterceptors(IdempotencyKeyInterceptor)
  async setPrimary(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: SetPrimaryWarehouseDto,
    @Req() request: AssignmentRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.assignments.setPrimary(id, dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('campaigns/:id/warehouses/reevaluate')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async reevaluate(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: ReevaluateCampaignWarehousesDto,
    @Req() request: AssignmentRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.assignments.reevaluate(id, dto?.clear_manual === true, request);
    replay(response, result.replay);
    return result.value;
  }
}
