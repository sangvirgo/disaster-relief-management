import { Type } from 'class-transformer';
import {
  IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

const transitionTargets = ['EN_ROUTE', 'ON_SCENE', 'COMPLETED', 'FAILED'] as const;
const onBehalfTargets = ['ACCEPTED', 'DECLINED', ...transitionTargets] as const;
const recordedBases = ['RADIO', 'PHONE', 'IN_PERSON', 'OTHER'] as const;

export class MissionPageQueryDto {
  @IsOptional() @IsString() @MaxLength(2_000)
  declare cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  declare limit?: number;
}

export class MissionVersionDto {
  @Type(() => Number) @IsInt() @Min(1)
  expected_version!: number;
}

export class CreateMissionDto extends MissionVersionDto {
  @IsUUID('all')
  team_id!: string;

  @IsOptional() @IsString() @MaxLength(2_000) @Matches(/\S/u)
  declare override_reason?: string;
}

export class MissionReasonDto extends MissionVersionDto {
  @IsString() @MaxLength(2_000) @Matches(/\S/u)
  reason!: string;
}

export class MissionOutcomeDto {
  @IsString() @MaxLength(2_000) @Matches(/\S/u)
  outcome_note!: string;
}

export class MissionTransitionDto extends MissionVersionDto {
  @IsIn(transitionTargets)
  to!: (typeof transitionTargets)[number];

  @IsOptional() @IsString() @MaxLength(2_000) @Matches(/\S/u)
  declare note?: string;

  @IsOptional() @ValidateNested() @Type(() => MissionOutcomeDto)
  declare result?: MissionOutcomeDto;
}

export class RecordMissionOnBehalfDto extends MissionVersionDto {
  @IsIn(onBehalfTargets)
  to!: (typeof onBehalfTargets)[number];

  @IsIn(recordedBases)
  recorded_basis!: (typeof recordedBases)[number];

  @IsString() @MaxLength(200) @Matches(/\S/u)
  reported_by!: string;

  @IsString() @MaxLength(2_000) @Matches(/\S/u)
  reason!: string;

  @IsDateString({ strict: true, strictSeparator: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u)
  occurred_at!: string;

  @IsOptional() @IsString() @MaxLength(2_000) @Matches(/\S/u)
  declare note?: string;

  @IsOptional() @ValidateNested() @Type(() => MissionOutcomeDto)
  declare result?: MissionOutcomeDto;
}
