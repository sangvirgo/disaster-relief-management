import { label, requestStatusLabel } from '../i18n/labels';
import { Badge } from './ui/Badge';
import { statusTone } from './statusTone';

export { statusTone } from './statusTone';

export function StatusBadge({ status, context }: { status: string; context?: 'sos' }) {
  const text = context === 'sos' ? requestStatusLabel(status) : label(status);
  return <Badge tone={statusTone(status)} title={text}>{text}</Badge>;
}
