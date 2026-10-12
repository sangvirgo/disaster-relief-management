import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID,
  Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const decimalValue = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

export class DonationDisputePageQueryDto {
  @IsOptional() @IsIn(['OPEN', 'RESOLVED'])
  status?: 'OPEN' | 'RESOLVED';

  @IsOptional() @IsString() @MaxLength(2_048)
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}

export class CreateDonationReceiptDto {
  @IsUUID('all')
  delivery_id!: string;

  @IsUUID('all')
  warehouse_id!: string;
}

export class ReceiptCountLineDto {
  @IsUUID('all')
  item_id!: string;

  @IsString() @Matches(decimalValue)
  counted_quantity!: string;

  @IsString() @Matches(decimalValue)
  accepted_quantity!: string;

  @IsString() @Matches(decimalValue)
  held_quantity!: string;

  @IsString() @Matches(decimalValue)
  rejected_quantity!: string;

  @IsOptional() @IsString() @MaxLength(1_000)
  condition_note?: string;

  @IsOptional() @IsDateString({ strict: true })
  expiry_date?: string;
}

export class RecordReceiptCountDto {
  @IsInt() @Min(1)
  expected_version!: number;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ReceiptCountLineDto)
  lines!: ReceiptCountLineDto[];

  @IsOptional() @IsString() @MaxLength(1_000)
  note?: string;
}

export class ReviewDonationReceiptDto {
  @IsInt() @Min(1)
  expected_version!: number;

  @IsInt() @Min(1)
  count_revision!: number;

  @IsInt() @Min(1)
  declaration_revision!: number;

  @IsIn(['APPROVE', 'REJECT', 'REQUEST_RECOUNT'])
  decision!: 'APPROVE' | 'REJECT' | 'REQUEST_RECOUNT';

  @IsOptional() @IsString() @MaxLength(1_000)
  reason?: string;
}

export class PostDonationReceiptDto {
  @IsInt() @Min(1)
  expected_version!: number;
}

export class ReleaseHeldDonationDto {
  @IsInt() @Min(1)
  expected_version!: number;

  @IsInt() @Min(1)
  count_revision!: number;

  @IsInt() @Min(1)
  declaration_revision!: number;

  @IsString() @MaxLength(1_000) @Matches(/\S/u)
  reason!: string;
}

export class ResolveDonationDisputeDto {
  @IsString() @MaxLength(2_000) @Matches(/\S/u)
  resolution_note!: string;
}
