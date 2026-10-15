import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { AssetsQueriesService } from './assets-queries.service';
import {
  AssetPageQueryDto, CreateReliefPointDto, CreateVehicleDto, CreateWarehouseDto, DeactivateAssetDto,
  PatchReliefPointDto, PatchVehicleDto, PatchWarehouseDto,
} from './assets.dto';
import { AssetsService } from './assets.service';

type AssetRequest = Request & { idempotencyKey?: string };

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

function replay(response: Response, value: boolean): void {
  if (value) response.setHeader('Idempotent-Replay', 'true');
}

@Controller()
export class AssetsController {
  constructor(private readonly assets: AssetsService, private readonly queries: AssetsQueriesService) {}

  @Get('warehouses')
  warehouses(@Query() query: AssetPageQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.list('warehouse', query, request);
  }

  @Get('relief-points')
  reliefPoints(@Query() query: AssetPageQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.list('relief_point', query, request);
  }

  @Get('relief-points/:id')
  reliefPointDetail(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.reliefPointDetail(id, request);
  }

  @Get('vehicles')
  vehicles(@Query() query: AssetPageQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.queries.list('vehicle', query, request);
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

  @Post('relief-points')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async createReliefPoint(@Body() dto: CreateReliefPointDto, @Req() request: AssetRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.assets.createReliefPoint(dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Patch('relief-points/:id')
  @UseInterceptors(IdempotencyKeyInterceptor)
  async patchReliefPoint(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: PatchReliefPointDto, @Req() request: AssetRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.assets.patchReliefPoint(id, dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('relief-points/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async deactivateReliefPoint(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: DeactivateAssetDto, @Req() request: AssetRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.assets.deactivate('relief_point', id, dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('vehicles')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async createVehicle(@Body() dto: CreateVehicleDto, @Req() request: AssetRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.assets.createVehicle(dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Patch('vehicles/:id')
  @UseInterceptors(IdempotencyKeyInterceptor)
  async patchVehicle(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: PatchVehicleDto, @Req() request: AssetRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.assets.patchVehicle(id, dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('vehicles/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async deactivateVehicle(@Param('id', new ParseUUIDPipe({ version: 'all' })) id: string, @Body() dto: DeactivateAssetDto, @Req() request: AssetRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.assets.deactivate('vehicle', id, dto, request);
    replay(response, result.replay);
    return result.value;
  }
}
