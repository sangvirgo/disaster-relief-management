import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { RequestLocationDto } from '../requests/request-intake.dto';

const trackingCode = /^[0-9A-HJKMNP-TV-Z]{10,16}$/;

export class TrackingCodeHeaderDto {
  @IsString() @Matches(trackingCode)
  tracking_code!: string;
}

export class ClaimRequestDto {
  @IsString() @Matches(trackingCode)
  tracking_code!: string;
}

export class MineQueryDto {
  @IsOptional() @IsString() @MaxLength(2_000)
  declare cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  declare limit?: number;
}

export class RequestEventsQueryDto {
  @IsOptional() @IsString() @MaxLength(2_000)
  declare cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  declare limit?: number;
}

export class SupplementRequestDto {
  @IsInt() @Min(1)
  expected_version!: number;

  @IsOptional() @IsString() @MaxLength(2000)
  declare description?: string;

  @IsOptional() @IsString() @MaxLength(500)
  declare household_reference_note?: string;

  @IsOptional() @IsInt() @Min(1) @Max(10000)
  declare people_affected?: number | null;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => RequestLocationDto)
  declare location?: RequestLocationDto;

  @IsOptional() @IsBoolean()
  declare reporter_declared_danger?: boolean;
}

export class RecoverRequestDto {
  @IsString() @Matches(trackingCode)
  tracking_code!: string;
}

export class RecoveryIssueDto {
  @IsInt() @Min(1)
  expected_version!: number;

  @IsString() @MaxLength(1000) @Matches(/\S/u)
  reason!: string;

  @IsUUID('all')
  contact_attempt_id!: string;

  @IsOptional() @IsString() @MaxLength(1000)
  declare source_note?: string;
}

export class RevokeTrackingSecretDto {
  @IsInt() @Min(1)
  expected_version!: number;
}

export class EvidenceIdDto {
  @IsUUID('all')
  id!: string;
}
