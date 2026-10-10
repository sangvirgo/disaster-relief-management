import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateRegionDto {
  @IsString() @Matches(/^[A-Z0-9_]{2,32}$/)
  code!: string;

  @IsString() @MinLength(1) @MaxLength(120) @Matches(/\S/u)
  name!: string;
}

export class DeactivateRegionDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;

  @IsString() @MinLength(1) @MaxLength(500) @Matches(/\S/u)
  reason!: string;
}

export class RegionListQueryDto {
  @IsOptional() @IsString() @MaxLength(2048)
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
