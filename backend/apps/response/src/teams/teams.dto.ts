import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsDateString, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';

const skillCodePattern = /^[A-Z0-9_]{2,40}$/u;
const regionCodePattern = /^[A-Z0-9_]{2,32}$/u;

export class TeamPageQueryDto {
  @IsOptional() @IsString() @MaxLength(2_000)
  declare cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  declare limit?: number;

  @IsOptional() @IsString() @Matches(regionCodePattern)
  declare region_code?: string;

  @IsOptional() @IsIn(['AVAILABLE', 'UNAVAILABLE'])
  declare availability?: 'AVAILABLE' | 'UNAVAILABLE';

  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE'])
  declare status?: 'ACTIVE' | 'INACTIVE';
}

export class TeamMembersPageQueryDto {
  @IsOptional() @IsString() @MaxLength(2_048)
  declare cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  declare limit?: number;
}

export class TeamMemberCandidatesQueryDto extends TeamMembersPageQueryDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(2) @MaxLength(64) @Matches(/\S/u)
  query!: string;
}

export class CreateTeamDto {
  @IsString() @MaxLength(200) @Matches(/\S/u)
  name!: string;

  @IsUUID('all')
  organization_id!: string;

  @IsString() @Matches(regionCodePattern)
  operating_region_code!: string;

  @IsIn(['VOLUNTEER', 'MILITARY', 'GOVERNMENT', 'OTHER'])
  team_kind!: 'VOLUNTEER' | 'MILITARY' | 'GOVERNMENT' | 'OTHER';

  @IsIn(['APP', 'COORDINATOR'])
  reporting_mode!: 'APP' | 'COORDINATOR';

  @IsOptional() @IsUUID('all')
  declare leader_user_id?: string;

  @IsOptional() @IsString() @MaxLength(1_000) @Matches(/\S/u)
  declare external_contact_note?: string;

  @IsArray() @ArrayMaxSize(50) @ArrayUnique() @Matches(skillCodePattern, { each: true })
  skill_codes!: string[];
}

export class UpdateTeamDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;

  @IsOptional() @IsString() @MaxLength(200) @Matches(/\S/u)
  declare name?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(50) @ArrayUnique() @Matches(skillCodePattern, { each: true })
  declare skill_codes?: string[];

  @IsOptional() @IsIn(['AVAILABLE', 'UNAVAILABLE'])
  declare availability?: 'AVAILABLE' | 'UNAVAILABLE';
}

export class AddTeamMemberDto {
  @IsUUID('all')
  user_id!: string;
}

export class TransferTeamLeaderDto {
  @IsUUID('all')
  user_id!: string;

  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;
}

export class TeamPositionLocationDto {
  @IsIn(['Point'])
  type!: 'Point';

  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(2) @IsNumber({}, { each: true })
  coordinates!: [number, number];

  @IsIn(['GPS', 'MANUAL_PIN', 'COORDINATOR_REPORTED'])
  source!: 'GPS' | 'MANUAL_PIN' | 'COORDINATOR_REPORTED';
}

export class SetTeamPositionDto {
  @IsObject() @ValidateNested() @Type(() => TeamPositionLocationDto)
  location!: TeamPositionLocationDto;

  @IsOptional() @IsNumber() @Min(0) @Max(9_999_999.9)
  declare accuracy_m?: number | null;

  @IsDateString({ strict: true, strictSeparator: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u)
  captured_at!: string;

  @IsOptional() @IsString() @MaxLength(1_000)
  declare note?: string;
}
