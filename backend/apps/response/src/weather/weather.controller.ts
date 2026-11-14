import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import { IsBooleanString, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { WeatherService } from './weather.service';

export class WeatherAlertsQueryDto {
  @IsOptional() @IsBooleanString()
  declare active_only?: string;
}

/** Vietnam and its waters; keeps the public point lookup from being used as a free world forecast proxy. */
export class WeatherPointQueryDto {
  @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(7.5) @Max(24.5)
  latitude!: number;

  @Type(() => Number) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(101.5) @Max(112)
  longitude!: number;
}

@Controller()
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  /** Public: citizens and coordinators read the same cached forecast-based warnings. */
  @Get('weather/alerts')
  alerts(@Query() query: WeatherAlertsQueryDto, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'public, max-age=300');
    return this.weather.alerts(query.active_only === 'true');
  }

  /** Public: forecast, alerts and hourly rain/gust series for the caller's chosen point. */
  @Get('weather/at')
  at(@Query() query: WeatherPointQueryDto, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'public, max-age=300');
    return this.weather.forecastAt(query.latitude, query.longitude);
  }
}
