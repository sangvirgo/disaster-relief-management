import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

export const WAREHOUSE_SERVICE_RADIUS_MIN_M = 1;
export const WAREHOUSE_SERVICE_RADIUS_MAX_M = 200_000;

export class AssetPageQueryDto {
  @IsOptional() @IsString() @MaxLength(2_000)
  declare cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  declare limit?: number;

  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE'])
  declare status?: 'ACTIVE' | 'INACTIVE';
}

export class AssetPointDto {
  @IsIn(['Point'])
  type!: 'Point';

  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(2) @IsNumber({}, { each: true })
  coordinates!: [number, number];
}

abstract class AssetCreateDto {}

export class CreateWarehouseDto extends AssetCreateDto {
  @IsString() @MaxLength(200) @Matches(/\S/u)
  name!: string;

  @IsOptional() @IsString() @MaxLength(1_000)
  declare address_note?: string | null;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => AssetPointDto)
  declare location?: AssetPointDto | null;

  @IsOptional() @IsBoolean()
  declare location_public?: boolean;

  @IsOptional() @IsInt() @Min(WAREHOUSE_SERVICE_RADIUS_MIN_M) @Max(WAREHOUSE_SERVICE_RADIUS_MAX_M)
  declare service_radius_m?: number | null;
}

export class PatchWarehouseDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;

  @IsOptional() @IsString() @MaxLength(200) @Matches(/\S/u)
  declare name?: string;

  @IsOptional() @IsString() @MaxLength(1_000)
  declare address_note?: string | null;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => AssetPointDto)
  declare location?: AssetPointDto | null;

  @IsOptional() @IsBoolean()
  declare location_public?: boolean;

  @IsOptional() @IsInt() @Min(WAREHOUSE_SERVICE_RADIUS_MIN_M) @Max(WAREHOUSE_SERVICE_RADIUS_MAX_M)
  declare service_radius_m?: number | null;
}

export class DeactivateAssetDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;
}
