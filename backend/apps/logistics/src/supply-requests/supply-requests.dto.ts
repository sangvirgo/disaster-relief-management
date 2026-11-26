import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const decimalQuantity = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
export const pickupCodePattern = /^[0-9]{6}$/u;

export const supplyRequestStatuses = ['READY', 'HANDED_OVER', 'CANCELLED', 'EXPIRED'] as const;
export type SupplyRequestStatus = (typeof supplyRequestStatuses)[number];

/** Upper bound of distinct items in one request; a team carries a short list, not a warehouse order. */
export const SUPPLY_REQUEST_MAX_LINES = 30;

export class SupplyRequestLineDto {
  @IsUUID('all')
  item_id!: string;

  @IsString() @MaxLength(100) @Matches(decimalQuantity)
  quantity!: string;
}

export class CreateSupplyRequestDto {
  @IsUUID('all')
  mission_id!: string;

  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(SUPPLY_REQUEST_MAX_LINES) @ValidateNested({ each: true }) @Type(() => SupplyRequestLineDto)
  lines!: SupplyRequestLineDto[];
}

export class SupplyRequestVersionDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(2_147_483_647)
  expected_version!: number;
}

export class HandOverSupplyRequestDto extends SupplyRequestVersionDto {
  /** The code the team shows at the warehouse. It proves the right team is collecting. */
  @IsString() @Matches(pickupCodePattern)
  pickup_code!: string;
}

export class CancelSupplyRequestDto extends SupplyRequestVersionDto {
  @IsString() @MaxLength(1_000) @Matches(/\S/u)
  reason!: string;
}

export class MissionSupplyQueryDto {
  @IsUUID('all')
  mission_id!: string;
}

export class SupplyQueueQueryDto {
  @IsOptional() @IsIn(supplyRequestStatuses)
  status?: SupplyRequestStatus;

  @IsOptional() @IsUUID('all')
  warehouse_id?: string;

  @IsOptional() @IsString() @MaxLength(2_000)
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
