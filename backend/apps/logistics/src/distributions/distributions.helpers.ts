import { AppError } from '@c48/technical/errors/errors';

export type DistributionHandoffKind = 'DIRECT_HOUSEHOLD' | 'RETURN' | 'LOSS';

/** Returned or lost goods always come from the in-transit balance; the column stays so history keeps its shape. */
export type HandoffSourceStage = 'IN_TRANSIT' | null;
export type SettlementType = 'DELIVERED' | 'RETURNED' | 'LOST';

export interface CustodyBalance {
  inTransit: bigint;
}

interface HandoffBalanceInput extends CustodyBalance {
  handoffKind: DistributionHandoffKind;
  sourceStage: HandoffSourceStage;
  quantity: bigint;
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
  const { handoffKind, sourceStage, quantity, inTransit } = input;
  if (quantity <= 0n || inTransit < 0n) {
    throw new AppError('VALIDATION_FAILED', { status: 400 });
  }

  if (handoffKind === 'DIRECT_HOUSEHOLD') {
    if (sourceStage !== null) return invalidHandoffKind();
    return { inTransit: checkedRemainder(inTransit, quantity) };
  }

  if ((handoffKind !== 'RETURN' && handoffKind !== 'LOSS') || sourceStage !== 'IN_TRANSIT') {
    return invalidHandoffKind();
  }
  return { inTransit: checkedRemainder(inTransit, quantity) };
}

export function handoffSettlementType(handoffKind: DistributionHandoffKind): SettlementType {
  if (handoffKind === 'DIRECT_HOUSEHOLD') return 'DELIVERED';
  return handoffKind === 'RETURN' ? 'RETURNED' : 'LOST';
}
