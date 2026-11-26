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

export class EstimateCategoryDto {
  @IsString() @Matches(/^[A-Z0-9_]{2,40}$/u)
  category!: string;

  /** Optional: when absent the norm's default item is used. */
  @ValidateIf((_object, value) => value !== undefined) @IsUUID('all')
  item_id?: string;
}

/**
 * The SOS facts (people, children, elderly, status, relief flag) are read from Response, never typed in here.
 * Without `categories` the bundle is every active norm with in_default_bundle = true.
 */
export class EstimateNeedsDto {
  @IsUUID('all')
  request_id!: string;

  @IsInt() @Min(1)
  work_cycle!: number;

  @ValidateIf((_object, value) => value !== undefined) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(16)
  @ValidateNested({ each: true }) @Type(() => EstimateCategoryDto)
  categories?: EstimateCategoryDto[];
}

export class ConfirmNeedDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;

  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(100) @Matches(decimalQuantity)
  quantity?: string;

  /** Optional swap to another ACTIVE item of the same item type. Requires reason. */
  @ValidateIf((_object, value) => value !== undefined) @IsUUID('all')
  item_id?: string;

  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(1_000) @Matches(/\S/u)
  reason?: string;
}

/** Up to 9 whole digits and 3 decimals, matching numeric(12,3) of need_norm. */
const normQuantity = /^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,3})?$/u;

export class NeedNormPatchDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;

  @ValidateIf((_object, value) => value !== undefined) @IsIn(['BY_GROUP', 'PER_N_PEOPLE', 'PER_REQUEST'])
  quantity_basis?: 'BY_GROUP' | 'PER_N_PEOPLE' | 'PER_REQUEST';

  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(20) @Matches(normQuantity)
  qty_adult?: string;

  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(20) @Matches(normQuantity)
  qty_child?: string;

  @ValidateIf((_object, value) => value !== undefined) @IsString() @MaxLength(20) @Matches(normQuantity)
  qty_elderly?: string;

  /** Only for PER_N_PEOPLE. */
  @ValidateIf((_object, value) => value !== undefined && value !== null) @Type(() => Number) @IsInt() @Min(1) @Max(10_000)
  people_per_unit?: number | null;

  /** Only for PER_REQUEST. */
  @ValidateIf((_object, value) => value !== undefined && value !== null) @IsString() @MaxLength(20) @Matches(normQuantity)
  fixed_quantity?: string | null;

  /** Null clears the default. Must be an ACTIVE item of the norm's item type (checked by the service). */
  @ValidateIf((_object, value) => value !== undefined && value !== null) @IsUUID('all')
  default_item_id?: string | null;

  @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  in_default_bundle?: boolean;

  @ValidateIf((_object, value) => value !== undefined) @IsBoolean()
  active?: boolean;
}
