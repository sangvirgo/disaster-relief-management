import { AppError } from '@c48/technical/errors/errors';

/** Hours a HANDED_OVER ticket may hold goods before the coordinator read model shows a warning. No automatic action. */
export const PICKUP_OVERDUE_HOURS = 48;

export const RETIRE_REASONS = ['CONSUMED', 'EXPIRED', 'DAMAGED', 'LOST', 'NOT_RETURNABLE'] as const;
export type RetireReason = (typeof RETIRE_REASONS)[number];

/** The only place where retire reason codes are mapped to Vietnamese copy. Codes stay stable for clients. */
export const RETIRE_REASON_LABELS: Readonly<Record<RetireReason, string>> = {
  CONSUMED: 'Đã sử dụng hết',
  EXPIRED: 'Hết hạn sử dụng',
  DAMAGED: 'Hư hỏng',
  LOST: 'Thất lạc',
  NOT_RETURNABLE: 'Không được nhập lại kho',
};

/**
 * Per-item figures in stock units (bigint, scaled). held = issued to the ticket. delivered = DIRECT_HOUSEHOLD handoffs.
 * remaining = goods still on the team side (in transit plus at point). Each distribution line contributes its in-transit
 * capacity to the allocation of deliveries, returns and retirements.
 */
export interface BaselineItem {
  item_id: string;
  item_name: string;
  unit_code: string;
  scale: number;
  returnable: boolean;
  perishable: boolean;
  held: bigint;
  delivered: bigint;
  remaining: bigint;
  ledgerBalanced: boolean;
  lines: Array<{ distribution_line_id: string; in_transit: bigint }>;
}

export interface CloseoutAmounts {
  returned: bigint;
  retired: bigint;
  reason: RetireReason | null;
}

/** Proposal used when no close-out has been saved yet. Non-returnable and perishable items are retired by default. */
export function proposeAmounts(item: BaselineItem): CloseoutAmounts {
  const remaining = item.held - item.delivered;
  if (remaining <= 0n) return { returned: 0n, retired: 0n, reason: null };
  if (!item.returnable) return { returned: 0n, retired: remaining, reason: 'NOT_RETURNABLE' };
  if (item.perishable) return { returned: 0n, retired: remaining, reason: 'EXPIRED' };
  return { returned: remaining, retired: 0n, reason: null };
}

/**
 * Enforces the close-out invariant delivered + returned + retired = held for one item, the return rule and the retire reason.
 * Returns the normalised amounts (reason is null when nothing is retired).
 */
export function validateAmounts(item: BaselineItem, input: CloseoutAmounts): CloseoutAmounts {
  if (input.returned < 0n || input.retired < 0n) throw new AppError('VALIDATION_FAILED', { status: 400 });
  // Perishable goods are never restocked: the close-out has no expiry date, so a perishable item counts as expired here.
  if (input.returned > 0n && (!item.returnable || item.perishable)) {
    throw new AppError('ITEM_NOT_RETURNABLE', { status: 409, details: { item_id: item.item_id } });
  }
  if (input.retired > 0n && input.reason === null) {
    throw new AppError('CLOSEOUT_RETIRE_REASON_REQUIRED', { status: 400, details: { item_id: item.item_id } });
  }
  if (input.returned + input.retired !== item.held - item.delivered) {
    throw new AppError('CLOSEOUT_INVARIANT_VIOLATED', {
      status: 409,
      details: { item_id: item.item_id, held: item.held.toString(), delivered: item.delivered.toString() },
    });
  }
  return { returned: input.returned, retired: input.retired, reason: input.retired > 0n ? input.reason : null };
}

/**
 * Greedy allocation of an amount across lines in the given order, each line limited by its capacity.
 * The caller checks that the allocated total equals the amount it asked for.
 */
export function allocate(
  lines: ReadonlyArray<{ id: string; capacity: bigint }>,
  amount: bigint,
): { allocations: Map<string, bigint>; allocated: bigint } {
  const allocations = new Map<string, bigint>();
  let left = amount;
  for (const line of lines) {
    if (left <= 0n) break;
    if (line.capacity <= 0n) continue;
    const take = line.capacity < left ? line.capacity : left;
    allocations.set(line.id, take);
    left -= take;
  }
  return { allocations, allocated: amount - left };
}

/** Independent review: the reviewer must differ from the submitter and from the user who handed the goods over. */
export function assertIndependentCloseoutReviewer(submittedBy: string | null, handedOverBy: string | null, reviewerId: string): void {
  if (submittedBy === reviewerId) throw new AppError('SELF_REVIEW_FORBIDDEN', { status: 403 });
  if (handedOverBy === reviewerId) throw new AppError('SELF_HANDOFF_FORBIDDEN', { status: 403 });
}

/** Read-model warning only: a ticket handed over more than PICKUP_OVERDUE_HOURS ago that still holds goods. */
export function isHandoverOverdue(handedOverAt: Date | string | null, unaccounted: boolean, now: Date): boolean {
  if (!unaccounted || handedOverAt === null) return false;
  return now.getTime() - new Date(handedOverAt).getTime() > PICKUP_OVERDUE_HOURS * 3_600_000;
}
