import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class ReportPageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @IsString() @MaxLength(2048)
  cursor?: string;
}

export class StockSummaryQueryDto extends ReportPageQueryDto {
  @IsOptional() @IsUUID('all')
  warehouse_id?: string;
}

export class FulfillmentReportQueryDto extends ReportPageQueryDto {
  @IsUUID('all')
  campaign_id!: string;

  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;
}

export class PublicDonationReportQueryDto extends ReportPageQueryDto {
  @IsOptional() @IsUUID('all')
  drive_id?: string;

  @IsOptional() @IsUUID('all')
  campaign_id?: string;

  @IsOptional() @IsUUID('all')
  warehouse_id?: string;
}

export class ReconciliationQueryDto extends ReportPageQueryDto {
  @IsUUID('all')
  warehouse_id!: string;

  @IsOptional() @IsUUID('all')
  item_id?: string;
}
