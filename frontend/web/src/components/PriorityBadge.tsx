import { Badge } from './ui/Badge';

type Priority = 'P1' | 'P2' | 'P3' | 'P4' | null | undefined;

export function PriorityBadge({ priority }: { priority: Priority }) {
  if (!priority) return null;
  return <Badge kind="priority" priority={priority} ariaLabel={`Mức ưu tiên ${priority}`}>{priority}</Badge>;
}
