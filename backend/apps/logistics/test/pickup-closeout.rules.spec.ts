import { describe, expect, it } from '@jest/globals';
import { AppError } from '@c48/technical/errors/errors';
import {
  allocate, assertIndependentCloseoutReviewer, BaselineItem, isHandoverOverdue, PICKUP_OVERDUE_HOURS, proposeAmounts,
  RETIRE_REASON_LABELS, RETIRE_REASONS, validateAmounts,
} from '../src/pickup-tickets/pickup-closeout.rules';

function item(overrides: Partial<BaselineItem> = {}): BaselineItem {
  return {
    item_id: 'item-water', item_name: 'Nước uống', unit_code: 'CHAI', scale: 0, returnable: true, perishable: false,
    held: 10n, delivered: 4n, remaining: 6n, ledgerBalanced: true,
    lines: [{ distribution_line_id: 'line-1', in_transit: 6n }],
    ...overrides,
  };
}

function expectError(fn: () => unknown, code: string, status?: number): void {
  let caught: unknown;
  try { fn(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(AppError);
  expect((caught as AppError).code).toBe(code);
  if (status !== undefined) expect((caught as AppError).status).toBe(status);
}

describe('close-out default proposal', () => {
  it('returns the remaining goods of a returnable, non-perishable item', () => {
    expect(proposeAmounts(item())).toEqual({ returned: 6n, retired: 0n, reason: null });
  });

  it('retires non-returnable items with NOT_RETURNABLE by default', () => {
    expect(proposeAmounts(item({ returnable: false }))).toEqual({ returned: 0n, retired: 6n, reason: 'NOT_RETURNABLE' });
  });

  it('retires perishable items with EXPIRED by default, since the close-out has no expiry date', () => {
    expect(proposeAmounts(item({ perishable: true }))).toEqual({ returned: 0n, retired: 6n, reason: 'EXPIRED' });
  });

  it('proposes nothing when every held unit was delivered', () => {
    expect(proposeAmounts(item({ delivered: 10n, remaining: 0n }))).toEqual({ returned: 0n, retired: 0n, reason: null });
  });
});

describe('close-out invariant and return rules', () => {
  it('accepts a balanced split of the remaining goods', () => {
    expect(validateAmounts(item(), { returned: 4n, retired: 2n, reason: 'DAMAGED' })).toEqual({ returned: 4n, retired: 2n, reason: 'DAMAGED' });
  });

  it('refuses a split that does not add up to held minus delivered (invariant violation)', () => {
    expectError(() => validateAmounts(item(), { returned: 4n, retired: 1n, reason: 'CONSUMED' }), 'CLOSEOUT_INVARIANT_VIOLATED', 409);
    expectError(() => validateAmounts(item(), { returned: 5n, retired: 2n, reason: 'CONSUMED' }), 'CLOSEOUT_INVARIANT_VIOLATED', 409);
  });

  it('refuses to return a non-returnable item, with a stable code', () => {
    expectError(() => validateAmounts(item({ returnable: false }), { returned: 6n, retired: 0n, reason: null }), 'ITEM_NOT_RETURNABLE', 409);
  });

  it('refuses to return a perishable item, which is never restocked', () => {
    expectError(() => validateAmounts(item({ perishable: true }), { returned: 6n, retired: 0n, reason: null }), 'ITEM_NOT_RETURNABLE', 409);
  });

  it('requires a reason code for every retired quantity', () => {
    expectError(() => validateAmounts(item(), { returned: 4n, retired: 2n, reason: null }), 'CLOSEOUT_RETIRE_REASON_REQUIRED', 400);
  });

  it('drops the reason when nothing is retired', () => {
    expect(validateAmounts(item(), { returned: 6n, retired: 0n, reason: 'LOST' })).toEqual({ returned: 6n, retired: 0n, reason: null });
  });

  it('rejects negative amounts as a validation error', () => {
    expectError(() => validateAmounts(item(), { returned: -1n, retired: 7n, reason: 'LOST' }), 'VALIDATION_FAILED', 400);
  });
});

describe('allocation across distribution lines', () => {
  it('fills lines in order and never exceeds a line capacity', () => {
    const plan = allocate([{ id: 'a', capacity: 4n }, { id: 'b', capacity: 3n }], 5n);
    expect(plan.allocated).toBe(5n);
    expect(plan.allocations.get('a')).toBe(4n);
    expect(plan.allocations.get('b')).toBe(1n);
  });

  it('reports a short allocation when capacity is insufficient', () => {
    const plan = allocate([{ id: 'a', capacity: 2n }], 3n);
    expect(plan.allocated).toBe(2n);
  });
});

describe('independent close-out review', () => {
  it('rejects a review by the submitter (SELF_REVIEW_FORBIDDEN)', () => {
    expectError(() => assertIndependentCloseoutReviewer('user-a', 'user-b', 'user-a'), 'SELF_REVIEW_FORBIDDEN', 403);
  });

  it('rejects a review by the user who handed the goods over (SELF_HANDOFF_FORBIDDEN)', () => {
    expectError(() => assertIndependentCloseoutReviewer('user-a', 'user-b', 'user-b'), 'SELF_HANDOFF_FORBIDDEN', 403);
  });

  it('accepts a third user', () => {
    expect(() => assertIndependentCloseoutReviewer('user-a', 'user-b', 'user-c')).not.toThrow();
  });
});

describe('overdue warning (read model only)', () => {
  const now = new Date('2026-11-18T12:00:00.000Z');

  it('flags a HANDED_OVER ticket older than the window that still holds goods', () => {
    const old = new Date(now.getTime() - (PICKUP_OVERDUE_HOURS + 1) * 3_600_000).toISOString();
    expect(isHandoverOverdue(old, true, now)).toBe(true);
  });

  it('does not flag a recent handover, or a ticket with no goods left', () => {
    const recent = new Date(now.getTime() - 3_600_000).toISOString();
    const old = new Date(now.getTime() - (PICKUP_OVERDUE_HOURS + 1) * 3_600_000).toISOString();
    expect(isHandoverOverdue(recent, true, now)).toBe(false);
    expect(isHandoverOverdue(old, false, now)).toBe(false);
  });
});

describe('retire reason copy', () => {
  it('maps every stable reason code to Vietnamese copy', () => {
    expect([...RETIRE_REASONS]).toEqual(['CONSUMED', 'EXPIRED', 'DAMAGED', 'LOST', 'NOT_RETURNABLE']);
    for (const code of RETIRE_REASONS) {
      expect([...RETIRE_REASON_LABELS[code]].some((char) => char.charCodeAt(0) > 127)).toBe(true);
    }
  });
});
