import { IsDateString, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const utcTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

export class ReportSummaryQueryDto {
  @IsString()
  @Matches(utcTimestampPattern)
  @IsDateString({ strict: true, strictSeparator: true })
  from!: string;

  @IsString()
  @Matches(utcTimestampPattern)
  @IsDateString({ strict: true, strictSeparator: true })
  to!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  campaign_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  region_code?: string;
}
