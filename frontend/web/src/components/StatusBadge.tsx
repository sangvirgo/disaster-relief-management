import { label } from '../i18n/labels';
import { Badge } from './ui/Badge';
import { statusTone } from './statusTone';

export { statusTone } from './statusTone';

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)} title={label(status)}>{label(status)}</Badge>;
}
