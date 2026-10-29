import { AppError } from '@c48/technical/errors/errors';
import { handoffSettlementType, nextCustodyBalance } from '../src/distributions/distributions.helpers';

describe('distribution handoff helpers', () => {
  it.each([
    ['DIRECT_HOUSEHOLD', null, 10n, 0n, 3n, false, { inTransit: 7n, atPoint: 0n }],
    ['POINT_RECEIPT', null, 10n, 0n, 3n, true, { inTransit: 7n, atPoint: 3n }],
    ['HOUSEHOLD_HANDOUT', null, 0n, 10n, 3n, true, { inTransit: 0n, atPoint: 7n }],
    ['RETURN', 'IN_TRANSIT', 10n, 0n, 3n, false, { inTransit: 7n, atPoint: 0n }],
    ['RETURN', 'AT_POINT', 0n, 10n, 3n, true, { inTransit: 0n, atPoint: 7n }],
    ['LOSS', 'IN_TRANSIT', 10n, 0n, 3n, false, { inTransit: 7n, atPoint: 0n }],
    ['LOSS', 'AT_POINT', 0n, 10n, 3n, true, { inTransit: 0n, atPoint: 7n }],
  ] as const)('updates custody for %s at %s', (handoffKind, sourceStage, inTransit, atPoint, quantity, hasReliefPoint, expected) => {
    expect(nextCustodyBalance({ handoffKind, sourceStage, inTransit, atPoint, quantity, hasReliefPoint })).toEqual(expected);
  });

  it.each([
    ['DIRECT_HOUSEHOLD', null, true],
    ['POINT_RECEIPT', null, false],
    ['HOUSEHOLD_HANDOUT', null, false],
    ['RETURN', null, false],
    ['LOSS', 'AT_POINT', false],
  ] as const)('rejects invalid route %s / %s', (handoffKind, sourceStage, hasReliefPoint) => {
    expect(() => nextCustodyBalance({ handoffKind, sourceStage, inTransit: 4n, atPoint: 4n, quantity: 1n, hasReliefPoint }))
      .toThrow(AppError);
  });

  it('rejects a handoff that exceeds its source-stage balance', () => {
    try {
      nextCustodyBalance({ handoffKind: 'DIRECT_HOUSEHOLD', sourceStage: null, inTransit: 2n, atPoint: 0n, quantity: 3n, hasReliefPoint: false });
      throw new Error('expected HANDOFF_EXCEEDS_BALANCE');
    } catch (error) {
      expect(error).toMatchObject({ code: 'HANDOFF_EXCEEDS_BALANCE' });
    }
  });

  it.each([
    ['FINAL_RECIPIENT', 'DIRECT_HOUSEHOLD', null, 'DELIVERED'],
    ['FINAL_RECIPIENT', 'HOUSEHOLD_HANDOUT', null, 'DELIVERED'],
    ['FINAL_RECIPIENT', 'POINT_RECEIPT', null, null],
    ['FINAL_RECIPIENT', 'RETURN', 'IN_TRANSIT', 'RETURNED'],
    ['RELIEF_POINT', 'POINT_RECEIPT', null, 'DELIVERED'],
    ['RELIEF_POINT', 'HOUSEHOLD_HANDOUT', null, null],
    ['RELIEF_POINT', 'RETURN', 'IN_TRANSIT', 'RETURNED'],
    ['RELIEF_POINT', 'RETURN', 'AT_POINT', null],
    ['RELIEF_POINT', 'LOSS', 'IN_TRANSIT', 'LOST'],
    ['RELIEF_POINT', 'LOSS', 'AT_POINT', null],
  ] as const)('maps target %s and handoff %s/%s to %s settlement', (target, handoffKind, sourceStage, expected) => {
    expect(handoffSettlementType(target, handoffKind, sourceStage)).toBe(expected);
  });
});
