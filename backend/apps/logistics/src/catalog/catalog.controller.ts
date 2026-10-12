import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, Res, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IdempotencyKeyInterceptor } from '../../../../packages/technical/src/idempotency/idempotency.interceptor';
import { CatalogService } from './catalog.service';
import { CatalogPageQueryDto, CreateItemDto, CreateItemTypeDto, CreateUnitDto, DeactivateItemDto, ItemPageQueryDto } from './catalog.dto';

type LogisticsRequest = Request & { idempotencyKey?: string };

function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

function replay(response: Response, value: boolean): void {
  if (value) response.setHeader('Idempotent-Replay', 'true');
}

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('item-types')
  itemTypes(@Query() query: CatalogPageQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.catalog.itemTypes(query, request);
  }

  @Get('units')
  units(@Query() query: CatalogPageQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.catalog.units(query, request);
  }

  @Get('items')
  items(@Query() query: ItemPageQueryDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    return this.catalog.items(query, request);
  }

  @Post('item-types')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async createItemType(@Body() dto: CreateItemTypeDto, @Req() request: LogisticsRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.catalog.createItemType(dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('units')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async createUnit(@Body() dto: CreateUnitDto, @Req() request: LogisticsRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.catalog.createUnit(dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('items')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async createItem(@Body() dto: CreateItemDto, @Req() request: LogisticsRequest, @Res({ passthrough: true }) response: Response) {
    noStore(response);
    const result = await this.catalog.createItem(dto, request);
    replay(response, result.replay);
    return result.value;
  }

  @Post('items/:id/deactivate')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyKeyInterceptor)
  async deactivateItem(
    @Param('id', new ParseUUIDPipe({ version: 'all' })) id: string,
    @Body() dto: DeactivateItemDto,
    @Req() request: LogisticsRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    noStore(response);
    const result = await this.catalog.deactivateItem(id, dto, request);
    replay(response, result.replay);
    return result.value;
  }

}
