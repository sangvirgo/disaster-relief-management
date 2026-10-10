import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString() @MinLength(3) @MaxLength(64) @Matches(/^[A-Za-z0-9._-]+$/)
  username!: string;

  @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/u)
  display_name!: string;

  @IsString() @MinLength(10) @MaxLength(256)
  temporary_password!: string;

  @IsOptional() @IsUUID('all')
  organization_id?: string;
}

export class UserVersionActionDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;

  @IsString() @MinLength(1) @MaxLength(500) @Matches(/\S/u)
  reason!: string;
}

export class ResetPasswordDto extends UserVersionActionDto {
  @IsString() @MinLength(10) @MaxLength(256)
  temporary_password!: string;
}

export class UserListQueryDto {
  @IsOptional() @IsString() @MaxLength(64)
  query?: string;

  @IsOptional() @IsIn(['ACTIVE', 'DISABLED'])
  status?: 'ACTIVE' | 'DISABLED';

  @IsOptional() @IsString() @MaxLength(2048)
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
