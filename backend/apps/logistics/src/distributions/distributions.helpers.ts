import { AppError } from '@c48/technical/errors/errors';

export type DistributionHandoffKind =
  | 'DIRECT_HOUSEHOLD'
  | 'POINT_RECEIPT'
  | 'HOUSEHOLD_HANDOUT'
  | 'RETURN'
  | 'LOSS';

export type HandoffSourceStage = 'IN_TRANSIT' | 'AT_POINT' | null;
export type FulfillmentTarget = 'FINAL_RECIPIENT' | 'RELIEF_POINT';
export type SettlementType = 'DELIVERED' | 'RETURNED' | 'LOST';

export interface CustodyBalance {
  inTransit: bigint;
  atPoint: bigint;
}

interface HandoffBalanceInput extends CustodyBalance {
  handoffKind: DistributionHandoffKind;
  sourceStage: HandoffSourceStage;
  quantity: bigint;
  hasReliefPoint: boolean;
}

function invalidHandoffKind(): never {
  throw new AppError('HANDOFF_KIND_INVALID', { status: 409 });
}

function checkedRemainder(balance: bigint, quantity: bigint): bigint {
  if (quantity <= 0n || quantity > balance) {
    throw new AppError('HANDOFF_EXCEEDS_BALANCE', { status: 409 });
  }
  return balance - quantity;
}

export function nextCustodyBalance(input: HandoffBalanceInput): CustodyBalance {
  const { handoffKind, sourceStage, quantity, inTransit, atPoint, hasReliefPoint } = input;
  if (quantity <= 0n || inTransit < 0n || atPoint < 0n) {
    throw new AppError('VALIDATION_FAILED', { status: 400 });
  }

  if (handoffKind === 'DIRECT_HOUSEHOLD') {
    if (hasReliefPoint || sourceStage !== null) return invalidHandoffKind();
    return { inTransit: checkedRemainder(inTransit, quantity), atPoint };
  }

  if (handoffKind === 'POINT_RECEIPT') {
    if (!hasReliefPoint || sourceStage !== null) return invalidHandoffKind();
    return { inTransit: checkedRemainder(inTransit, quantity), atPoint: atPoint + quantity };
  }

  if (handoffKind === 'HOUSEHOLD_HANDOUT') {
    if (!hasReliefPoint || sourceStage !== null) return invalidHandoffKind();
    return { inTransit, atPoint: checkedRemainder(atPoint, quantity) };
  }

  if ((handoffKind !== 'RETURN' && handoffKind !== 'LOSS') || sourceStage === null ||
      (sourceStage === 'AT_POINT' && !hasReliefPoint)) {
    return invalidHandoffKind();
  }

  if (sourceStage === 'IN_TRANSIT') {
    return { inTransit: checkedRemainder(inTransit, quantity), atPoint };
  }
  return { inTransit, atPoint: checkedRemainder(atPoint, quantity) };
}

export function handoffSettlementType(
  target: FulfillmentTarget,
  handoffKind: DistributionHandoffKind,
  sourceStage: HandoffSourceStage,
): SettlementType | null {
  if (target === 'FINAL_RECIPIENT') {
    if (handoffKind === 'DIRECT_HOUSEHOLD' || handoffKind === 'HOUSEHOLD_HANDOUT') return 'DELIVERED';
    if (handoffKind === 'RETURN') return 'RETURNED';
    if (handoffKind === 'LOSS') return 'LOST';
    return null;
  }

  if (handoffKind === 'POINT_RECEIPT') return 'DELIVERED';
  if (sourceStage !== 'IN_TRANSIT') return null;
  if (handoffKind === 'RETURN') return 'RETURNED';
  if (handoffKind === 'LOSS') return 'LOST';
  return null;
}
