import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class SetPrimaryWarehouseDto {
  @IsUUID('all')
  warehouse_id!: string;

  @IsInt() @Min(0) @Max(2_147_483_647)
  expected_version!: number;

  @IsString() @MinLength(1) @MaxLength(500) @Matches(/\S/u)
  reason!: string;
}

export class ReevaluateCampaignWarehousesDto {
  @IsOptional() @IsBoolean()
  clear_manual?: boolean;
}
