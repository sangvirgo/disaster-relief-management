import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { HeatmapQueryDto } from './map.dto';
import { MapService } from './map.service';

@Controller()
export class MapController {
  constructor(private readonly map: MapService) {}

  @Get('map/heatmap')
  heatmap(
    @Query() query: HeatmapQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    response.setHeader('Cache-Control', 'no-store');
    return this.map.heatmap(query, request);
  }
}
