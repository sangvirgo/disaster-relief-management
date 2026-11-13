import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { IsBooleanString, IsOptional, IsString, Matches } from 'class-validator';
import { WeatherService } from './weather.service';

export class WeatherAlertsQueryDto {
  @IsOptional() @IsString() @Matches(/^[A-Z0-9_]{2,32}$/u)
  declare region_code?: string;

  @IsOptional() @IsBooleanString()
  declare active_only?: string;
}

@Controller()
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  /** Public: citizens and coordinators read the same cached forecast-based warnings. */
  @Get('weather/alerts')
  alerts(@Query() query: WeatherAlertsQueryDto, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'public, max-age=300');
    return this.weather.alerts(query.region_code, query.active_only === 'true');
  }
}
