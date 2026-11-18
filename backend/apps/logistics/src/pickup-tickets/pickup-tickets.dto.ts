import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';

export const pickupTicketStatuses = ['OPEN', 'READY', 'HANDED_OVER', 'CLOSED', 'CANCELLED'] as const;

export class CreatePickupTicketDto {
  @IsUUID('all')
  mission_id!: string;

  /** Optional. Must be assigned to the mission's campaign (PRIMARY or BACKUP). Defaults to the campaign PRIMARY warehouse. */
  @IsOptional() @IsUUID('all')
  warehouse_id?: string;
}

export class PickupExpectedVersionDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(2_147_483_647)
  expected_version!: number;
}

export class HandoverPickupTicketDto extends PickupExpectedVersionDto {
  /** Optional volunteer who physically collected the goods. Must be an active member of the mission's team. */
  @IsOptional() @IsUUID('all')
  collected_by_user_id?: string;
}

export class CancelPickupTicketDto extends PickupExpectedVersionDto {
  @IsString() @MaxLength(1_000) @Matches(/\S/u)
  reason!: string;
}

export class PickupTicketListQueryDto {
  @IsOptional() @IsUUID('all')
  mission_id?: string;

  @IsOptional() @IsIn(pickupTicketStatuses)
  status?: (typeof pickupTicketStatuses)[number];

  @IsOptional() @IsString() @MaxLength(2_000)
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;
}
