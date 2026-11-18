import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
  ValidateIf, ValidateNested,
} from 'class-validator';

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

export class EstimateCategoryDto {
  @IsString() @Matches(/^[A-Z0-9_]{2,40}$/u)
  category!: string;

  @IsUUID('all')
  item_id!: string;
}

export class EstimateNeedsDto {
  @IsUUID('all')
  request_id!: string;

  @IsInt() @Min(1)
  work_cycle!: number;

  @IsInt() @Min(1) @Max(10_000)
  people_count!: number;

  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) @Max(30)
  days?: number;

  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(0) @Max(10_000)
  infants?: number;

  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(0) @Max(10_000)
  elderly?: number;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => EstimateCategoryDto)
  categories!: EstimateCategoryDto[];
}

export class ConfirmNeedDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;

  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(100) @Matches(decimalQuantity)
  quantity?: string;

  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(1_000) @Matches(/\S/u)
  reason?: string;
}

const decimalNorm = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

export class NeedNormPatchDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;

  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(20) @Matches(decimalNorm)
  qty_per_person_per_day?: string;

  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(20) @Matches(decimalNorm)
  modifier_infant?: string;

  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(20) @Matches(decimalNorm)
  modifier_elderly?: string;

  @ValidateIf((_object, value) => value !== undefined) @IsIn(['PER_PERSON_DAY', 'PER_PERSON'])
  quantity_basis?: 'PER_PERSON_DAY' | 'PER_PERSON';

  @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  active?: boolean;
}
