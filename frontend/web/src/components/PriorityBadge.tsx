type Priority = 'P1' | 'P2' | 'P3' | 'P4' | null | undefined;

export function PriorityBadge({ priority }: { priority: Priority }) {
  if (!priority) return null;
  return <span className="priority-badge" data-priority={priority} aria-label={`Mức ưu tiên ${priority}`}>{priority}</span>;
}
