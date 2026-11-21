import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import './Dropdown.css';

type Option = { value: string; label: ReactNode; disabled: boolean };
type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children' | 'value' | 'defaultValue'> & {
  children: ReactNode;
  value: string | number;
};

function readOptions(children: ReactNode): Option[] {
  const result: Option[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const element = child as React.ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>;
    if (element.type === 'option') {
      result.push({ value: String(element.props.value ?? ''), label: element.props.children, disabled: Boolean(element.props.disabled) });
    } else if (element.props.children) {
      result.push(...readOptions(element.props.children));
    }
  });
  return result;
}

/** A bounded, inline alternative to the browser's unbounded native select menu. */
export function Dropdown({ children, value, onChange, onBlur, required, className = '', disabled, ...rest }: Props) {
  const options = readOptions(children);
  const selected = options.find((option) => option.value === String(value)) ?? options[0];
  const menuOptions = required ? options.filter((option) => option.value !== '') : options;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [placement, setPlacement] = useState({ top: 0, left: 0, width: 0, maxHeight: 260 });

  useLayoutEffect(() => {
    if (!open) return;
    const positionList = () => {
      const rect = trigger.current?.getBoundingClientRect();
      const menu = list.current;
      if (!rect || !menu || !trigger.current) return;
      const dialog = trigger.current?.closest('dialog');
      const bounds = dialog?.getBoundingClientRect();
      // Measure the rendered portal. Fixed positioning inside an animated, scrolling
      // dialog has a different origin from fixed positioning in the page body.
      const scale = rect.width / trigger.current.offsetWidth || 1;
      const menuRect = menu.getBoundingClientRect();
      const topEdge = Math.max(8, bounds?.top ?? 8);
      const bottomEdge = Math.min(window.innerHeight - 8, bounds?.bottom ?? window.innerHeight - 8);
      const below = bottomEdge - rect.bottom - 5;
      const above = rect.top - topEdge - 5;
      const fullHeight = Math.min(260, menu.scrollHeight * scale);
      const openAbove = below < fullHeight && above > below;
      const maxHeight = Math.max(0, Math.min(260, openAbove ? above : below));
      const visibleHeight = Math.min(fullHeight, maxHeight);
      const top = openAbove ? rect.top - visibleHeight - 5 : rect.bottom + 5;
      const left = Math.max(bounds?.left ?? 8, Math.min(rect.left, (bounds?.right ?? window.innerWidth - 8) - rect.width));
      setPlacement((current) => {
        const next = {
          top: current.top + (top - menuRect.top) / scale,
          left: current.left + (left - menuRect.left) / scale,
          width: rect.width / scale,
          maxHeight: maxHeight / scale,
        };
        return Math.abs(next.top - current.top) < 0.5 && Math.abs(next.left - current.left) < 0.5 &&
          Math.abs(next.width - current.width) < 0.5 && Math.abs(next.maxHeight - current.maxHeight) < 0.5
          ? current : next;
      });
    };
    positionList();
    window.addEventListener('resize', positionList);
    window.addEventListener('scroll', positionList, true);
    const dialog = trigger.current?.closest('dialog');
    dialog?.addEventListener('animationend', positionList);
    return () => {
      window.removeEventListener('resize', positionList);
      window.removeEventListener('scroll', positionList, true);
      dialog?.removeEventListener('animationend', positionList);
    };
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !list.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  function choose(next: Option) {
    if (next.disabled) return;
    onChange?.({ target: { value: next.value }, currentTarget: { value: next.value } } as ChangeEvent<HTMLSelectElement>);
    setOpen(false);
    trigger.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (open && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const buttons = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? []);
      if (!buttons.length) return;
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[index]?.focus();
    }
  }

  return <div ref={root} className={`ui-dropdown ${open ? 'is-open' : ''} ${className}`} onKeyDown={onKeyDown}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !list.current?.contains(event.relatedTarget as Node | null)) {
        setOpen(false);
        onBlur?.(event as unknown as React.FocusEvent<HTMLSelectElement>);
      }
    }}>
    <button {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)} ref={trigger} type="button"
      className="ui-dropdown__trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
      aria-controls={open ? listId : undefined} aria-required={required || undefined}
      onClick={() => setOpen((current) => !current)}>
      <span className="ui-dropdown__value">{selected?.label ?? 'Chọn một mục'}</span>
      <span className="ui-dropdown__chevron" aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={list} id={listId} className="ui-dropdown__list" role="listbox" aria-label={rest['aria-label']}
      style={{ top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.maxHeight }}
      onKeyDown={onKeyDown} onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}>
      {menuOptions.map((option, index) => <button key={`${option.value}-${index}`} type="button" role="option"
        aria-selected={option.value === String(value)} disabled={option.disabled}
        className={`ui-dropdown__option ${option.value === String(value) ? 'is-selected' : ''}`}
        onClick={() => choose(option)}>{option.label}</button>)}
    </div>, trigger.current?.closest('dialog') ?? document.body)}
  </div>;
}
