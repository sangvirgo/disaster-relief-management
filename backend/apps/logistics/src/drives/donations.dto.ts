import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength,
  Min, MinLength, ValidateNested,
} from 'class-validator';

const decimalPattern = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

export class DonationLineDto {
  @IsUUID('all')
  item_id!: string;

  @IsString() @Matches(decimalPattern)
  declared_quantity!: string;
}

export class CreateDonationDeliveryDto {
  @IsString() @MinLength(1) @MaxLength(200) @Matches(/\S/u)
  donor_name!: string;

  @IsString() @Matches(/^\+?[0-9]{8,15}$/u)
  donor_phone!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => DonationLineDto)
  lines!: DonationLineDto[];
}

export class DeclarationRevisionDto {
  @IsInt() @Min(1)
  expected_version!: number;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => DonationLineDto)
  lines!: DonationLineDto[];
}

export class OpenDonationDisputeDto {
  @IsString() @MinLength(1) @MaxLength(2000) @Matches(/\S/u)
  reason!: string;
}

export class DonationPageQueryDto {
  @IsOptional() @IsUUID('all')
  drive_id?: string;

  @IsOptional() @IsIn(['DECLARED', 'COUNTING', 'PENDING_REVIEW', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED'])
  status?: string;

  @IsOptional() @IsString() @MaxLength(2048)
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
