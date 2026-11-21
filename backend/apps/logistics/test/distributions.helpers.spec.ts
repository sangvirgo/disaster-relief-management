import { AppError } from '@c48/technical/errors/errors';
import { handoffSettlementType, nextCustodyBalance } from '../src/distributions/distributions.helpers';

describe('distribution handoff helpers', () => {
  it.each([
    ['DIRECT_HOUSEHOLD', null, 10n, 3n, { inTransit: 7n }],
    ['RETURN', 'IN_TRANSIT', 10n, 3n, { inTransit: 7n }],
    ['LOSS', 'IN_TRANSIT', 10n, 3n, { inTransit: 7n }],
  ] as const)('updates custody for %s at %s', (handoffKind, sourceStage, inTransit, quantity, expected) => {
    expect(nextCustodyBalance({ handoffKind, sourceStage, inTransit, quantity })).toEqual(expected);
  });

  it.each([
    ['DIRECT_HOUSEHOLD', 'IN_TRANSIT'],
    ['RETURN', null],
    ['LOSS', null],
  ] as const)('rejects invalid route %s / %s', (handoffKind, sourceStage) => {
    expect(() => nextCustodyBalance({ handoffKind, sourceStage, inTransit: 4n, quantity: 1n })).toThrow(AppError);
  });

  it('rejects a handoff that exceeds its in-transit balance', () => {
    try {
      nextCustodyBalance({ handoffKind: 'DIRECT_HOUSEHOLD', sourceStage: null, inTransit: 2n, quantity: 3n });
      throw new Error('expected HANDOFF_EXCEEDS_BALANCE');
    } catch (error) {
      expect(error).toMatchObject({ code: 'HANDOFF_EXCEEDS_BALANCE' });
    }
  });

  it.each([
    ['DIRECT_HOUSEHOLD', 'DELIVERED'],
    ['RETURN', 'RETURNED'],
    ['LOSS', 'LOST'],
  ] as const)('maps handoff %s to %s settlement', (handoffKind, expected) => {
    expect(handoffSettlementType(handoffKind)).toBe(expected);
  });
});
