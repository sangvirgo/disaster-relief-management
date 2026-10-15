import { Type } from 'class-transformer';
import {
  IsDateString, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf,
} from 'class-validator';

const regionCodePattern = /^[A-Z0-9_]{2,32}$/u;

export class CampaignPageQueryDto {
  @IsOptional() @IsString() @MaxLength(2_000)
  declare cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  declare limit?: number;
}

export class CampaignCreateDto {
  @IsString() @MinLength(1) @Matches(/\S/u)
  name!: string;

  @IsOptional() @IsString()
  declare objective?: string | null;

  @IsOptional() @IsString() @Matches(regionCodePattern)
  declare region_code?: string | null;

  @IsOptional() @IsDateString()
  declare starts_at?: string | null;

  @IsOptional() @IsDateString()
  declare ends_at?: string | null;
}

export class CampaignPatchDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;

  @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(1) @Matches(/\S/u)
  declare name?: string;

  @IsOptional() @IsString()
  declare objective?: string | null;

  @IsOptional() @IsString() @Matches(regionCodePattern)
  declare region_code?: string | null;

  @IsOptional() @IsDateString()
  declare starts_at?: string | null;

  @IsOptional() @IsDateString()
  declare ends_at?: string | null;
}

export class CampaignActionDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;
}

export class CampaignReasonActionDto extends CampaignActionDto {
  @IsString() @MinLength(1) @Matches(/\S/u)
  reason!: string;
}
