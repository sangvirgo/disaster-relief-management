import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID,
  Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const decimalQuantity = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

export const distributionPurposes = ['REQUEST_AID', 'CAMPAIGN_DISTRIBUTION', 'POINT_REPLENISHMENT'] as const;
export const handoffKinds = ['DIRECT_HOUSEHOLD', 'POINT_RECEIPT', 'HOUSEHOLD_HANDOUT', 'RETURN', 'LOSS'] as const;

export class DistributionLineDto {
  @IsUUID('all')
  item_id!: string;

  @IsString() @MaxLength(100) @Matches(decimalQuantity)
  quantity!: string;

  @IsOptional() @IsUUID('all')
  commitment_id?: string;
}

export class CreateDistributionDto {
  @IsUUID('all')
  warehouse_id!: string;

  @IsOptional() @IsUUID('all')
  relief_point_id?: string;

  @IsOptional() @IsUUID('all')
  vehicle_id?: string;

  @IsOptional() @IsUUID('all')
  campaign_id?: string;

  @IsIn(distributionPurposes)
  purpose!: typeof distributionPurposes[number];

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => DistributionLineDto)
  lines!: DistributionLineDto[];
}

export class ExpectedDistributionVersionDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;
}

export class ReplaceDistributionLinesDto extends ExpectedDistributionVersionDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => DistributionLineDto)
  lines!: DistributionLineDto[];
}

export class HandoffLineDto {
  @IsUUID('all')
  distribution_line_id!: string;

  @IsString() @MaxLength(100) @Matches(decimalQuantity)
  quantity!: string;
}

export class CreateHandoffDto {
  @IsIn(handoffKinds)
  handoff_kind!: typeof handoffKinds[number];

  @IsOptional() @IsIn(['IN_TRANSIT', 'AT_POINT'])
  source_stage?: 'IN_TRANSIT' | 'AT_POINT';

  @IsOptional() @IsUUID('all')
  receiver_user_id?: string;

  @IsOptional() @IsString() @MaxLength(200) @Matches(/\S/u)
  receiver_label?: string;

  @IsString() @MaxLength(1_000) @Matches(/\S/u)
  confirmation_basis!: string;

  @IsDateString()
  occurred_at!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => HandoffLineDto)
  lines!: HandoffLineDto[];
}

export class ReviewLossDto extends ExpectedDistributionVersionDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  @IsString() @MaxLength(1_000) @Matches(/\S/u)
  reason!: string;
}

export class DistributionListQueryDto {
  @IsOptional() @IsIn(['DRAFT', 'APPROVED', 'DISPATCHED', 'RECONCILED', 'CANCELLED'])
  status?: 'DRAFT' | 'APPROVED' | 'DISPATCHED' | 'RECONCILED' | 'CANCELLED';

  @IsOptional() @IsString() @MaxLength(2_000)
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
