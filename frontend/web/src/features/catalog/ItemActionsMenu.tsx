import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function ItemActionsMenu({ name, onEdit, onAliases, onDelete }: {
  name: string; onEdit: () => void; onAliases: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    if (!open || !trigger.current || !menu.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const rendered = menu.current.getBoundingClientRect();
    const scale = rendered.width / menu.current.offsetWidth || 1;
    const top = window.innerHeight - anchor.bottom < rendered.height + 8
      ? anchor.top - rendered.height - 4 : anchor.bottom + 4;
    const left = Math.max(8, Math.min(anchor.right - rendered.width, window.innerWidth - rendered.width - 8));
    setPosition((current) => {
      const next = { top: current.top + (top - rendered.top) / scale, left: current.left + (left - rendered.left) / scale };
      return Math.abs(next.top - current.top) < 0.5 && Math.abs(next.left - current.left) < 0.5 ? current : next;
    });
  }, [open, position]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnScroll = () => setOpen(false);
    document.addEventListener('pointerdown', outside);
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', closeOnScroll);
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('resize', closeOnScroll);
    };
  }, [open]);

  function choose(action: () => void) { setOpen(false); action(); }

  return <>
    <button ref={trigger} type="button" className="catalog-item-menu-trigger" aria-label={`Thao tác với ${name}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen((current) => !current)}>⋮</button>
    {open && createPortal(<div ref={menu} id={id} role="menu" aria-label={`Thao tác với ${name}`}
      className="catalog-item-menu" style={{ top: position.top, left: position.left }}
      onKeyDown={(event) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } }}>
      <button type="button" role="menuitem" onClick={() => choose(onEdit)}>Sửa vật phẩm</button>
      <button type="button" role="menuitem" onClick={() => choose(onAliases)}>Sửa từ khóa</button>
      <button type="button" role="menuitem" className="catalog-item-menu__danger" onClick={() => choose(onDelete)}>Xóa vật phẩm</button>
    </div>, document.body)}
  </>;
}
