import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { PickupExpectedVersionDto } from './pickup-tickets.dto';
import { RETIRE_REASONS } from './pickup-closeout.rules';

export class DeliveryLineDto {
  @IsUUID('all')
  item_id!: string;

  /** Decimal string in the item unit; scale is checked against the unit (QUANTITY_SCALE_INVALID). */
  @IsString() @MaxLength(30) @Matches(/^\d+(\.\d+)?$/u)
  quantity!: string;
}

export class DeliverPickupGoodsDto extends PickupExpectedVersionDto {
  /** Client-supplied time of the handover on scene. Sent again on retry so the idempotency hash stays the same. */
  @IsDateString()
  occurred_at!: string;

  /** Optional label for the household or person who received the goods. Defaults to a generic Vietnamese label. */
  @IsOptional() @IsString() @MaxLength(200) @Matches(/\S/u)
  receiver_label?: string;

  @ValidateNested({ each: true }) @Type(() => DeliveryLineDto)
  @ArrayMinSize(1) @ArrayMaxSize(50)
  lines!: DeliveryLineDto[];
}

export class CloseoutLineDto {
  @IsUUID('all')
  item_id!: string;

  @IsString() @MaxLength(30) @Matches(/^\d+(\.\d+)?$/u)
  returned_quantity!: string;

  @IsString() @MaxLength(30) @Matches(/^\d+(\.\d+)?$/u)
  retired_quantity!: string;

  @IsOptional() @IsIn(RETIRE_REASONS)
  retire_reason?: (typeof RETIRE_REASONS)[number];

  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

export class SaveCloseoutDto {
  /** Version of the open close-out; 0 when no close-out has been saved yet. */
  @Type(() => Number) @IsInt() @Min(0) @Max(2_147_483_647)
  expected_version!: number;

  @ValidateNested({ each: true }) @Type(() => CloseoutLineDto)
  @ArrayMinSize(1) @ArrayMaxSize(50)
  lines!: CloseoutLineDto[];
}

export class ReviewCloseoutDto extends PickupExpectedVersionDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision!: 'APPROVE' | 'REJECT';

  /** Required for REJECT. Optional for APPROVE. */
  @IsOptional() @IsString() @MaxLength(1_000)
  note?: string;
}
