import { Type } from 'class-transformer';
import { IsIn, IsInt, IsString, IsUUID, Matches, MaxLength, Min, ValidateIf } from 'class-validator';

const decimalQuantity = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

export class CreateNeedDto {
  @IsUUID('all')
  request_id!: string;

  @IsInt() @Min(1)
  work_cycle!: number;

  @IsUUID('all')
  item_id!: string;

  @IsString() @MaxLength(100) @Matches(decimalQuantity)
  quantity!: string;

  @ValidateIf((_object, value) => value !== undefined) @IsIn(['FINAL_RECIPIENT'])
  delivery_target_kind?: 'FINAL_RECIPIENT';

  @ValidateIf((_object, value) => value !== undefined) @IsUUID('all')
  designated_point_id?: string;

  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(500) @Matches(/\S/u)
  reason?: string;
}

export class AdjustNeedQuantityDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;

  @IsString() @MaxLength(100) @Matches(decimalQuantity)
  quantity!: string;

  @IsString() @MaxLength(1_000) @Matches(/\S/u)
  reason!: string;
}

export class CancelNeedDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;

  @IsString() @MaxLength(1_000) @Matches(/\S/u)
  reason!: string;
}
