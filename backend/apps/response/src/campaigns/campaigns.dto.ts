import { Type } from 'class-transformer';
import {
  IsDateString, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';

export class CampaignPageQueryDto {
  @IsOptional() @IsString() @MaxLength(2_000)
  declare cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  declare limit?: number;
}

export class CampaignCenterDto {
  @IsNumber() @Min(-90) @Max(90)
  lat!: number;

  @IsNumber() @Min(-180) @Max(180)
  lng!: number;
}

export const CAMPAIGN_RADIUS_MIN_M = 500;
export const CAMPAIGN_RADIUS_MAX_M = 300_000;

export class CampaignCreateDto {
  @IsString() @MinLength(1) @Matches(/\S/u)
  name!: string;

  @IsOptional() @IsString()
  declare objective?: string | null;

  @IsOptional() @IsDateString()
  declare starts_at?: string | null;

  @IsOptional() @IsDateString()
  declare ends_at?: string | null;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => CampaignCenterDto)
  declare center?: CampaignCenterDto | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(CAMPAIGN_RADIUS_MIN_M) @Max(CAMPAIGN_RADIUS_MAX_M)
  declare radius_m?: number | null;
}

export class CampaignPatchDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;

  @ValidateIf((_object, value) => value !== undefined) @IsString() @MinLength(1) @Matches(/\S/u)
  declare name?: string;

  @IsOptional() @IsString()
  declare objective?: string | null;

  @IsOptional() @IsDateString()
  declare starts_at?: string | null;

  @IsOptional() @IsDateString()
  declare ends_at?: string | null;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => CampaignCenterDto)
  declare center?: CampaignCenterDto | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(CAMPAIGN_RADIUS_MIN_M) @Max(CAMPAIGN_RADIUS_MAX_M)
  declare radius_m?: number | null;
}

export class CampaignActionDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;
}

export class CampaignReasonActionDto extends CampaignActionDto {
  @IsString() @MinLength(1) @Matches(/\S/u)
  reason!: string;
}

export class CampaignAreaDto extends CampaignActionDto {
  @IsObject() @ValidateNested() @Type(() => CampaignCenterDto)
  center!: CampaignCenterDto;

  @Type(() => Number) @IsInt() @Min(CAMPAIGN_RADIUS_MIN_M) @Max(CAMPAIGN_RADIUS_MAX_M)
  radius_m!: number;
}
