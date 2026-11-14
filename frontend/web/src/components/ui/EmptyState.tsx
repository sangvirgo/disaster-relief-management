import type { ReactNode } from 'react';
import './EmptyState.css';

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: 'empty' | 'lock';
}) {
  return (
    <div className="ui-empty-state">
      <svg
        className="ui-empty-state__icon"
        viewBox="0 0 40 40"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        aria-hidden="true"
      >
        {icon === 'lock' ? (
          <>
            <rect x="9" y="18" width="22" height="17" rx="3" />
            <path d="M14 18v-6a6 6 0 0 1 12 0v6" />
          </>
        ) : (
          <>
            <rect x="6" y="9" width="28" height="25" rx="3" />
            <path d="M12 17h16M12 23h12M12 29h8" />
          </>
        )}
      </svg>
      <strong>{title}</strong>
      <p>{description}</p>
      {action && <div className="ui-empty-state__action">{action}</div>}
    </div>
  );
}
