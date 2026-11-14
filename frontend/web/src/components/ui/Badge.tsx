import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export type BadgeKind = 'status' | 'priority' | 'role' | 'meta';

export function Badge({
  children,
  tone = 'neutral',
  kind = 'status',
  title,
  ariaLabel,
  priority,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  kind?: BadgeKind;
  title?: string;
  ariaLabel?: string;
  priority?: 'P1' | 'P2' | 'P3' | 'P4';
}) {
  return (
    <span
      className={`ui-badge ui-badge--${tone} ui-badge--${kind}`}
      data-priority={priority}
      title={title}
      aria-label={ariaLabel}
    >
      {kind === 'status' && <span className="ui-badge__dot" aria-hidden="true" />}
      <span className="ui-badge__label">{children}</span>
    </span>
  );
}
