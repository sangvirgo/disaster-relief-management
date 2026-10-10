import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
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
