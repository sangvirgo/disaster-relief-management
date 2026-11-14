import type { KeyboardEvent } from 'react';
import './Tabs.css';

export type TabItem = { id: string; label: string };

export function Tabs({
  items,
  value,
  onChange,
  ariaLabel,
  idBase,
  className = '',
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  idBase: string;
  className?: string;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = items.findIndex(item => item.id === value);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % items.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else return;
    event.preventDefault();
    const nextTab = items[nextIndex].id;
    onChange(nextTab);
    window.requestAnimationFrame(() => {
      document.getElementById(`${idBase}-tab-${nextTab}`)?.focus();
    });
  }

  return (
    <div className={`ui-tabs ${className}`.trim()} role="tablist" aria-label={ariaLabel}>
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={`${idBase}-tab-${item.id}`}
          aria-selected={value === item.id}
          aria-controls={`${idBase}-tabpanel`}
          tabIndex={value === item.id ? 0 : -1}
          onClick={() => onChange(item.id)}
          onKeyDown={onKeyDown}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
