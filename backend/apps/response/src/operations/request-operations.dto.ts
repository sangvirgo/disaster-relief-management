import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID,
  Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const statuses = ['SUBMITTED', 'VERIFYING', 'VERIFIED', 'REJECTED', 'DUPLICATE', 'TRIAGED', 'DISPATCHED', 'IN_PROGRESS', 'RESOLVING', 'RESOLVED', 'CLOSED', 'CANCELLED'];
const priorities = ['P1', 'P2', 'P3', 'P4'];
const reviewLanes = ['NORMAL', 'RATE_LIMITED_REVIEW', 'PROXY_QUOTA_REVIEW'];
const bboxPattern = /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/;

export class RequestOperationPageDto {
  @IsOptional() @IsString() @MaxLength(2_000)
  declare cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  declare limit?: number;
}

export class TeamCandidatesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  declare radius_m?: number;
}

export class RequestQueueQueryDto extends RequestOperationPageDto {
  @IsOptional() @IsIn(statuses)
  declare status?: string;

  @IsOptional() @IsString() @Matches(/^[A-Z0-9_]{2,32}$/u)
  declare region_code?: string;

  @IsOptional() @IsIn(priorities)
  declare priority?: string;

  @IsOptional() @IsIn(reviewLanes)
  declare review_lane?: string;

  @IsOptional() @IsString() @Matches(/^[A-Z0-9_]{2,32}$/u)
  declare category?: string;

  @IsOptional() @IsDateString()
  declare from?: string;

  @IsOptional() @IsDateString()
  declare to?: string;

  @IsOptional() @IsString() @MaxLength(128) @Matches(bboxPattern)
  declare bbox?: string;

  @IsOptional() @IsIn(['true', 'false'])
  declare declared_danger?: string;

  @IsOptional() @IsIn(['true', 'false'])
  declare overdue?: string;
}

export class RequestVersionDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;
}

export class ContactAttemptDto {
  @IsIn(['REPORTER', 'BENEFICIARY', 'ALTERNATE', 'AUTHORITY'])
  contact_target!: string;

  @IsIn(['REACHED', 'NO_ANSWER', 'WRONG_NUMBER', 'OTHER'])
  outcome!: string;

  @IsOptional() @IsString() @MaxLength(1000)
  declare note?: string;
}

export class VerificationSourceRefsDto {
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true })
  declare contact_attempt_ids?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true })
  declare evidence_ids?: string[];

  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true })
  declare request_ids?: string[];
}

export class VerifyRequestDto extends RequestVersionDto {
  @IsIn(['CONTACT_CONFIRMED', 'CORROBORATED', 'EVIDENCE_REVIEWED', 'TWO_COORDINATOR_JUDGMENT'])
  basis!: string;

  @IsOptional() @IsString() @MaxLength(1000)
  declare reason?: string;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => VerificationSourceRefsDto)
  declare source_refs?: VerificationSourceRefsDto;

  @IsOptional() @IsString() @MaxLength(1000)
  declare source_note?: string;

  @IsOptional() @IsUUID('all')
  declare concurrence_event_id?: string;
}

export class ConcurRequestDto extends RequestVersionDto {
  @IsString() @MaxLength(1000) @Matches(/\S/u)
  note!: string;
}

export class RejectRequestDto extends RequestVersionDto {
  @IsString() @MaxLength(1000) @Matches(/\S/u)
  reason!: string;

  @IsOptional() @IsIn(['CLEARLY_INVALID', 'UNREACHABLE', 'OTHER'])
  declare reason_kind?: string;
}

export class DuplicateRequestDto extends RequestVersionDto {
  @IsUUID('all')
  canonical_request_id!: string;

  @IsString() @MaxLength(1000) @Matches(/\S/u)
  reason!: string;
}

export class TriageRequestDto extends RequestVersionDto {
  @IsIn(priorities)
  priority!: string;

  @IsIn(['COMPLETE', 'INCOMPLETE_INFO'])
  priority_basis!: string;

  @IsOptional() @IsString() @MaxLength(1000)
  declare reason?: string;
}

export class AuthorityReferralDto {
  @IsString() @MaxLength(200) @Matches(/\S/u)
  referred_body!: string;

  @IsString() @MaxLength(1000) @Matches(/\S/u)
  note!: string;
}

export class CorrectRegionDto extends RequestVersionDto {
  @IsString() @Matches(/^[A-Z0-9_]{2,32}$/u)
  region_code!: string;

  @IsString() @MaxLength(1000) @Matches(/\S/u)
  reason!: string;
}

export class SupplementReviewDto extends RequestVersionDto {
  @IsIn(['ACCEPT', 'REJECT'])
  decision!: string;

  @IsString() @MaxLength(1000) @Matches(/\S/u)
  reason!: string;

  @IsOptional() @IsObject() @ValidateNested() @Type(() => VerificationSourceRefsDto)
  declare source_refs?: VerificationSourceRefsDto;

  @IsOptional() @IsString() @MaxLength(1000)
  declare source_note?: string;
}
