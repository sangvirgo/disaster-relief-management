import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export class HeatmapQueryDto {
  @IsString()
  @Matches(utcTimestampPattern)
  @IsDateString({ strict: true, strictSeparator: true })
  from!: string;

  @IsString()
  @Matches(utcTimestampPattern)
  @IsDateString({ strict: true, strictSeparator: true })
  to!: string;

  @IsOptional()
  @IsIn(['confirmed', 'unverified'])
  status_layer?: 'confirmed' | 'unverified';

  @IsOptional()
  @IsString()
  @MaxLength(80)
  region_code?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  campaign_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  category?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn([250, 500, 1000, 2000, 5000])
  cell_m?: number;
}
