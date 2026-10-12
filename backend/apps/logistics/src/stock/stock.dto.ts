import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const decimalValue = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

export class StockPageQueryDto {
  @IsOptional() @IsString() @MaxLength(2_000)
  declare cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  declare limit?: number;
}

export class StockListQueryDto extends StockPageQueryDto {
  @IsOptional() @IsUUID('all')
  declare warehouse_id?: string;

  @IsOptional() @IsUUID('all')
  declare item_id?: string;
}

export class StockAdjustmentListQueryDto extends StockPageQueryDto {
  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED'])
  declare status?: 'PENDING' | 'APPROVED' | 'REJECTED';
}

export class OpeningStockLineDto {
  @IsUUID('all')
  item_id!: string;

  @IsString() @Matches(decimalValue)
  quantity!: string;
}

export class OpeningStockDto {
  @IsUUID('all')
  warehouse_id!: string;

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => OpeningStockLineDto)
  lines!: OpeningStockLineDto[];

  @IsString() @MaxLength(1_000) @Matches(/\S/u)
  note!: string;
}

export class CreateStockAdjustmentDto {
  @IsUUID('all')
  balance_id!: string;

  @IsString() @Matches(decimalValue)
  delta_on_hand!: string;

  @IsString() @MaxLength(1_000) @Matches(/\S/u)
  reason!: string;

  @IsOptional() @IsUUID('all')
  declare compensates_movement_id?: string;
}

export class ReviewStockAdjustmentDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @IsOptional() @IsString() @MaxLength(1_000)
  declare note?: string;
}
