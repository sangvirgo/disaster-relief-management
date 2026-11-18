import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength,
  ValidateNested,
} from 'class-validator';
import { DriveItemDto } from '../drives/drives.dto';

export class SupplyGapQueryDto {
  @IsOptional() @IsIn(['OPEN', 'ACCEPTED', 'DISMISSED', 'EXPIRED'])
  status?: 'OPEN' | 'ACCEPTED' | 'DISMISSED' | 'EXPIRED';

  @IsOptional() @IsUUID('all')
  warehouse_id?: string;

  @IsOptional() @IsString() @MaxLength(2048)
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

/** Manager edits applied to the suggested draft before the existing drive rules validate it. */
export class AcceptSupplyGapOverridesDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/u)
  title?: string;

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string | null;

  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => DriveItemDto)
  items?: DriveItemDto[];

  @IsOptional() @IsDateString({ strict: true })
  opens_at?: string;

  @IsOptional() @IsDateString({ strict: true })
  closes_at?: string;
}

export class AcceptSupplyGapDto {
  @IsInt() @Min(1)
  expected_version!: number;

  @IsOptional() @ValidateNested() @Type(() => AcceptSupplyGapOverridesDto)
  overrides?: AcceptSupplyGapOverridesDto;
}

export class DismissSupplyGapDto {
  @IsInt() @Min(1)
  expected_version!: number;

  @IsString() @MinLength(1) @MaxLength(500) @Matches(/\S/u)
  reason!: string;

  /** Cooldown length in days (1..90, default 7). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90)
  dismissed_days?: number;
}
