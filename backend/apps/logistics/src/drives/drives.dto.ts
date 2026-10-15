import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID,
  Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';

const decimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

export class DrivePageQueryDto {
  @IsOptional() @IsString() @MaxLength(2048)
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @IsIn(['DRAFT', 'OPEN', 'PAUSED', 'CLOSED'])
  status?: 'DRAFT' | 'OPEN' | 'PAUSED' | 'CLOSED';
}

export class DriveItemDto {
  @IsUUID('all')
  item_id!: string;

  @IsString() @Matches(decimalPattern)
  target_quantity!: string;

  @IsOptional() @IsString() @MaxLength(500)
  acceptance_note?: string;
}

export class CreateDriveDto {
  @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/u)
  title!: string;

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string | null;

  @IsUUID('all')
  intake_warehouse_id!: string;

  @IsOptional() @IsUUID('all')
  campaign_id?: string;

  @IsOptional() @IsDateString({ strict: true })
  opens_at?: string;

  @IsOptional() @IsDateString({ strict: true })
  closes_at?: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => DriveItemDto)
  items!: DriveItemDto[];
}

export class PatchDriveDto {
  @IsInt() @Min(1)
  expected_version!: number;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/u)
  title?: string;

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string | null;

  @ValidateIf((_object, value) => value !== undefined && value !== null) @IsUUID('all')
  campaign_id?: string | null;

  @ValidateIf((_object, value) => value !== undefined && value !== null) @IsDateString({ strict: true })
  opens_at?: string | null;

  @ValidateIf((_object, value) => value !== undefined && value !== null) @IsDateString({ strict: true })
  closes_at?: string | null;

  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => DriveItemDto)
  items?: DriveItemDto[];
}

export class DriveVersionActionDto {
  @IsInt() @Min(1)
  expected_version!: number;
}

export class DriveReasonActionDto extends DriveVersionActionDto {
  @IsString() @MinLength(1) @MaxLength(500) @Matches(/\S/u)
  reason!: string;
}
