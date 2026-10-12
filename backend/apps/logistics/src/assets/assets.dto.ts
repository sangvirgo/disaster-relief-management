import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const regionCode = /^[A-Z0-9_]{2,32}$/u;
const decimalQuantity = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

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

abstract class AssetCreateDto {
  @IsUUID('all')
  organization_id!: string;

  @IsString() @Matches(regionCode)
  region_code!: string;
}

export class CreateWarehouseDto extends AssetCreateDto {
  @IsString() @MaxLength(200) @Matches(/\S/u)
  name!: string;

  @IsOptional() @IsString() @MaxLength(1_000)
  declare address_note?: string | null;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => AssetPointDto)
  declare location?: AssetPointDto | null;

  @IsOptional() @IsBoolean()
  declare location_public?: boolean;
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
}

export class CreateReliefPointDto extends AssetCreateDto {
  @IsString() @MaxLength(200) @Matches(/\S/u)
  name!: string;

  @IsOptional() @IsString() @MaxLength(1_000)
  declare contact_note?: string | null;

  @IsOptional() @IsString() @MaxLength(1_000)
  declare operating_note?: string | null;

  @IsObject() @ValidateNested() @Type(() => AssetPointDto)
  location!: AssetPointDto;
}

export class PatchReliefPointDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;

  @IsOptional() @IsString() @MaxLength(200) @Matches(/\S/u)
  declare name?: string;

  @IsOptional() @IsString() @MaxLength(1_000)
  declare contact_note?: string | null;

  @IsOptional() @IsString() @MaxLength(1_000)
  declare operating_note?: string | null;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => AssetPointDto)
  declare location?: AssetPointDto;
}

export class CreateVehicleDto extends AssetCreateDto {
  @IsString() @MaxLength(100) @Matches(/\S/u)
  identifier!: string;

  @IsString() @MaxLength(80) @Matches(/\S/u)
  vehicle_type!: string;

  @IsOptional() @IsString() @Matches(decimalQuantity)
  declare capacity?: string | null;

  @IsOptional() @IsString() @Matches(/^[A-Z0-9_]{1,20}$/u)
  declare capacity_unit?: string | null;
}

export class PatchVehicleDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;

  @IsOptional() @IsString() @MaxLength(100) @Matches(/\S/u)
  declare identifier?: string;

  @IsOptional() @IsString() @MaxLength(80) @Matches(/\S/u)
  declare vehicle_type?: string;

  @IsOptional() @IsString() @Matches(decimalQuantity)
  declare capacity?: string | null;

  @IsOptional() @IsString() @Matches(/^[A-Z0-9_]{1,20}$/u)
  declare capacity_unit?: string | null;
}

export class DeactivateAssetDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;
}
