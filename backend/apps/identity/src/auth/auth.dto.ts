import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._-]+$/)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/u)
  display_name!: string;
}

export class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;

  @IsIn(['WEB', 'NATIVE'])
  client_kind!: 'WEB' | 'NATIVE';
}

export class RefreshDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  refresh_token?: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  current_password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  new_password!: string;
}
