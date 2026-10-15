import { IsIn, IsUUID } from 'class-validator';
import type { ResolutionOutcomeBasis } from '../integrations/response/response-cycle-intent.client';

const outcomeBases: readonly ResolutionOutcomeBasis[] = ['RESCUE_COMPLETED', 'SUPPLY_ONLY', 'NO_ACTION_REQUIRED'];

export class CycleIntentDto {
  @IsUUID('all')
  intent_id!: string;
}

export class SealCycleDto extends CycleIntentDto {
  @IsIn(outcomeBases)
  outcome_basis!: ResolutionOutcomeBasis;
}
