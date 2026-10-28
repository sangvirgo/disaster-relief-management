import { Type, Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ServiceName } from '../auth/service-tokens';

export class ServiceTokenDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  client_id!: string;

  @IsString()
  @MinLength(32)
  @MaxLength(256)
  client_secret!: string;

  @IsIn(['identity', 'response', 'logistics'])
  audience!: ServiceName;
}

export class IntrospectDto {
  @IsUUID('all')
  sid!: string;

  @IsUUID('all')
  sub!: string;
}

export class LookupUsersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  ids!: string[];
}

export class SearchActiveUsersDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(2) @MaxLength(64) @Matches(/\S/u)
  query!: string;

  @IsOptional() @IsString() @MaxLength(2_048)
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

export class ActiveUserCheckDto {
  @IsUUID('all')
  user_id!: string;
}

export class RegionLookupDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100)
  @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(80, { each: true }) @Matches(/\S/u, { each: true })
  codes!: string[];
}

export class TeamLeaderEligibilityDto {
  @IsUUID('all')
  user_id!: string;

  @IsUUID('all')
  organization_id!: string;
}

export class RequestCoordinatorQueryDto {
  @IsUUID('all')
  organization_id!: string;
}
