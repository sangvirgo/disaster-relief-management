import type { ReactNode } from 'react';
import './QueueRow.css';

export function QueueRow({
  title,
  meta,
  priority,
  status,
  time,
  details,
  selected,
  onClick,
}: {
  title: string;
  meta: string;
  priority?: ReactNode;
  status: ReactNode;
  time?: string;
  details?: ReactNode;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`queue-row ui-queue-row${selected ? ' ui-queue-row--selected' : ''}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      <span className="ui-queue-row__priority">{priority}</span>
      <span className="ui-queue-row__content">
        <strong title={title}>{title}</strong>
        <small title={meta}>{meta}</small>
        <span className="ui-queue-row__foot">
          <span className="ui-queue-row__status">{status}</span>
          {details}
          {time && <time className="ui-queue-row__time">{time}</time>}
        </span>
      </span>
      <svg
        className="ui-queue-row__chevron"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        aria-hidden="true"
      >
        <path d="m6 3 5 5-5 5" />
      </svg>
    </button>
  );
}
