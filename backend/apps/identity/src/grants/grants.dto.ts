import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, Matches } from 'class-validator';
import { Role, ScopeType } from '@c48/identity-contracts/permissions';

const roles: readonly Role[] = ['CITIZEN', 'VOLUNTEER', 'COORDINATOR', 'CAMPAIGN_MANAGER', 'OPERATIONS_MANAGER', 'INTAKE_STAFF', 'REVIEWER', 'DISTRIBUTION_STAFF', 'ADMIN'];
const scopes: readonly ScopeType[] = ['SYSTEM', 'ORGANIZATION', 'REGION', 'CAMPAIGN'];

export class CreateGrantDto {
  @IsIn(roles)
  role_code!: Role;

  @IsIn(scopes)
  scope_type!: ScopeType;

  @IsOptional() @IsUUID('all')
  organization_id?: string;

  @IsOptional() @IsString() @Matches(/^[A-Z0-9_]{2,32}$/)
  region_code?: string;

  @IsOptional() @IsUUID('all')
  campaign_id?: string;

  @IsString() @MinLength(1) @MaxLength(500) @Matches(/\S/u)
  reason!: string;
}

export class RevokeGrantDto {
  @IsString() @MinLength(1) @MaxLength(500) @Matches(/\S/u)
  reason!: string;
}

export class GrantListQueryDto {
  @IsOptional() @IsIn(['true', 'false'])
  include_revoked?: 'true' | 'false';

  @IsOptional() @IsString() @MaxLength(2048)
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
