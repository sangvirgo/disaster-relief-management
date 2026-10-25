import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

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

  @IsEmail() @MaxLength(254)
  email!: string;
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


export class GoogleLoginDto {
  @IsString()
  @MinLength(20)
  @MaxLength(8192)
  id_token!: string;

  @IsIn(['WEB', 'NATIVE'])
  client_kind!: 'WEB' | 'NATIVE';

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._-]+$/)
  first_time_username?: string;
}

export class VerifyEmailDto {
  @IsUUID('all')
  challenge_id!: string;

  @IsString() @Matches(/^\d{6}$/)
  code!: string;
}

export class ResendEmailOtpDto {
  @IsUUID('all')
  challenge_id!: string;
}

export class GoogleLinkDto {
  @IsString() @MinLength(20) @MaxLength(8192)
  id_token!: string;
}
