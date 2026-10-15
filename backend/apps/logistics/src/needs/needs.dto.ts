import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const decimalQuantity = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

export class NeedsListQueryDto {
  @IsOptional() @IsUUID('all')
  declare request_id?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  declare work_cycle?: number;

  @IsOptional() @IsString() @MaxLength(2_000)
  declare cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  declare limit?: number;
}

export class FulfillmentQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  declare work_cycle?: number;
}

export class NeedContributionsQueryDto {
  @IsOptional() @IsString() @MaxLength(2_000)
  declare cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  declare limit?: number;
}

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

export class CreateNeedCommitmentDto {
  @IsUUID('all')
  warehouse_id!: string;

  @IsString() @MaxLength(100) @Matches(decimalQuantity)
  quantity!: string;
}

export class ReleaseCommitmentDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;

  @IsString() @MaxLength(100) @Matches(decimalQuantity)
  quantity!: string;

  @IsString() @MaxLength(1_000) @Matches(/\S/u)
  reason!: string;
}
