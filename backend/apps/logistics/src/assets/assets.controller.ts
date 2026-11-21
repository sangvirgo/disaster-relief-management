import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IdempotencyKeyInterceptor } from '@c48/technical/idempotency/idempotency.interceptor';
import { AssetsQueriesService } from './assets-queries.service';
import {
  AssetPageQueryDto, CreateWarehouseDto, DeactivateAssetDto, PatchWarehouseDto,
} from './assets.dto';
import { AssetsService } from './assets.service';
import { noStore, markIdempotentReplay as replay } from '@c48/technical/http/response-headers';

type AssetRequest = Request & { idempotencyKey?: string };

@Controller()
export class AssetsController {
  constructor(private readonly assets: AssetsService, private readonly queries: AssetsQueriesService) {}

  @Get('warehouses')
  warehouses(@Query() query: AssetPageQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.list('warehouse', query, request);
  }

  @Get('warehouses/:id')
  warehouseDetail(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.warehouseDetail(id, request);
  }

  @Post('warehouses')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async createWarehouse(@Body() dto: CreateWarehouseDto, @Req() request: AssetRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.assets.createWarehouse(dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Patch('warehouses/:id')
  @UseInterceptors(IdempotencyKeyInterceptor)
  async patchWarehouse(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: PatchWarehouseDto, @Req() request: AssetRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.assets.patchWarehouse(id, dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('warehouses/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async deactivateWarehouse(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: DeactivateAssetDto, @Req() request: AssetRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.assets.deactivate('warehouse', id, dto, request);
    replay(response, result.replay);
    return result.value;
  }
}
