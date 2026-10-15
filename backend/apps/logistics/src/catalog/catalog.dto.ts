import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

const itemTypeCode = /^[A-Z0-9_]{2,40}$/u;
const unitCode = /^[A-Z0-9_]{1,20}$/u;

export class CatalogPageQueryDto {
  @IsOptional() @IsString() @MaxLength(2_000)
  declare cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  declare limit?: number;
}

export class ItemPageQueryDto extends CatalogPageQueryDto {
  @IsOptional() @IsString() @Matches(itemTypeCode)
  declare type?: string;

  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE'])
  declare status?: 'ACTIVE' | 'INACTIVE';

  @IsOptional() @IsString() @MaxLength(100)
  declare query?: string;
}

export class CreateItemTypeDto {
  @IsString() @Matches(itemTypeCode)
  code!: string;

  @IsString() @MaxLength(100) @Matches(/\S/u)
  display_name!: string;
}

export class CreateUnitDto {
  @IsString() @Matches(unitCode)
  code!: string;

  @IsString() @MaxLength(100) @Matches(/\S/u)
  display_name!: string;

  @Type(() => Number) @IsInt() @Min(0) @Max(3)
  scale!: number;
}

export class CreateItemDto {
  @IsString() @Matches(itemTypeCode)
  item_type_code!: string;

  @IsString() @Matches(unitCode)
  unit_code!: string;

  @IsString() @MaxLength(200) @Matches(/\S/u)
  name!: string;
}

export class DeactivateItemDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;
}
