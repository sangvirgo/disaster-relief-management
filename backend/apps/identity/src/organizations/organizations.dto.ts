import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { UserVersionActionDto } from '../users/users.dto';

export class CreateOrganizationDto {
  @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/u)
  name!: string;

  @IsIn(['COORDINATION', 'VOLUNTEER', 'MILITARY', 'GOVERNMENT', 'OTHER'])
  organization_kind!: 'COORDINATION' | 'VOLUNTEER' | 'MILITARY' | 'GOVERNMENT' | 'OTHER';
}

export class OrganizationActionDto extends UserVersionActionDto {}

export class AddMemberDto {
  @IsUUID('all')
  user_id!: string;
}

export class OrganizationListQueryDto {
  @IsOptional() @IsString() @MaxLength(2048)
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
