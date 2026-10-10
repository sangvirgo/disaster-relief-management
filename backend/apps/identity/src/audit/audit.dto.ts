import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class AuditListQueryDto {
  @IsString() @Matches(/^[a-z][a-z0-9_]{1,63}$/)
  entity_type!: string;

  @IsOptional() @IsString() @MaxLength(200)
  entity_id?: string;

  @IsOptional() @IsString() @MaxLength(2048)
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
