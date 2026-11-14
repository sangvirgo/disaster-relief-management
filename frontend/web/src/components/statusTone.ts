import type { BadgeTone } from './ui/Badge';

const tones: Record<string, BadgeTone> = {
  SUBMITTED: 'warning',
  VERIFYING: 'warning',
  RESOLVING: 'warning',
  VERIFIED: 'info',
  TRIAGED: 'info',
  DISPATCHED: 'info',
  IN_PROGRESS: 'info',
  OFFERED: 'info',
  ACCEPTED: 'info',
  EN_ROUTE: 'info',
  ON_SCENE: 'info',
  RESOLVED: 'success',
  COMPLETED: 'success',
  RECONCILED: 'success',
  ACTIVE: 'success',
  OPEN: 'success',
  APPROVED: 'success',
  POSTED: 'success',
  RECEIVED: 'info',
  AT_POINT: 'info',
  PAUSED: 'warning',
  COUNTING: 'warning',
  PENDING_REVIEW: 'warning',
  PENDING: 'warning',
  REJECTED: 'danger',
  FAILED: 'danger',
  DUPLICATE: 'neutral',
  CANCELLED: 'neutral',
  CLOSED: 'neutral',
  CLOSED_OUT: 'neutral',
};

export function statusTone(status: string): BadgeTone {
  return tones[status] ?? 'neutral';
}
