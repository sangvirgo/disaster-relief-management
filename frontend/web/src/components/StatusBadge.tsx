import { label } from '../i18n/labels';

export type StatusTone = 'success' | 'warning' | 'info' | 'muted' | 'danger';

export function statusTone(status: string): StatusTone {
  if (['ACTIVE', 'OPEN', 'APPROVED', 'POSTED', 'COMPLETED', 'RECONCILED'].includes(status)) return 'success';
  if (['PAUSED', 'COUNTING', 'PENDING_REVIEW', 'PENDING'].includes(status)) return 'warning';
  if (['CLOSED', 'CLOSED_OUT', 'DISPATCHED', 'RECEIVED'].includes(status)) return 'info';
  if (['REJECTED', 'CANCELLED', 'FAILED'].includes(status)) return 'danger';
  return 'muted';
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`chip status-badge status-badge-${statusTone(status)}`}>
    <span className="status-badge-dot" aria-hidden="true" />{label(status)}
  </span>;
}
