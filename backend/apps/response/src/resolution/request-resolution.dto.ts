import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import type { ResolutionOutcomeBasis } from '../integrations/logistics/logistics-cycle.client';

export class ResolveRequestDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;

  @IsString() @MaxLength(2_000) @Matches(/\S/u)
  resolution_reason!: string;

  @IsIn(['RESCUE_COMPLETED', 'SUPPLY_ONLY', 'NO_ACTION_REQUIRED'])
  outcome_basis!: ResolutionOutcomeBasis;
}

export class RequestVersionReasonDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;

  @IsString() @MaxLength(2_000) @Matches(/\S/u)
  reason!: string;
}

export class RequestVersionDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;
}

export class ReopenRequestDto extends RequestVersionReasonDto {
  @IsOptional() @IsUUID('all')
  declare campaign_id?: string | null;

  @IsOptional() @IsString() @MaxLength(80) @Matches(/\S/u)
  declare region_code?: string;
}

export class FailureReviewDto extends RequestVersionReasonDto {
  @IsIn(['REPLACED', 'NO_FURTHER_ACTION', 'REFERRED'])
  disposition!: 'REPLACED' | 'NO_FURTHER_ACTION' | 'REFERRED';

  @IsOptional() @IsUUID('all')
  replacement_mission_id?: string;
}
