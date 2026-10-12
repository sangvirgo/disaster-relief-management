import { AppError } from '../../../../packages/technical/src/errors/errors';

export { quantityUnits, validateQuantity } from '../common/quantity';

export const STOCK_ADJUSTMENT_ERROR_MAPPINGS = {
  check: {
    stock_balance_on_hand_check: 'ADJUSTMENT_VIOLATES_RESERVED',
    stock_balance_reserved_check: 'ADJUSTMENT_VIOLATES_RESERVED',
    stock_balance_reserved_check1: 'ADJUSTMENT_VIOLATES_RESERVED',
  },
} as const;

export function assertIndependentAdjustmentReviewer(requesterId: string, reviewerId: string): void {
  if (requesterId === reviewerId) throw new AppError('FORBIDDEN', { status: 403 });
}
