import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DetailCloseButton } from './DetailCloseButton';

export function DetailSurface({ modal, open, onClose, children, label = 'Chi tiết biên nhận' }: {
  label?: string; modal: boolean; open: boolean; onClose: () => void; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (modal && open) { setClosing(false); ref.current?.showModal(); }
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [modal, open]);
  function close() {
    if (!modal) { onClose(); return; }
    setClosing(true);
    timer.current = setTimeout(() => { ref.current?.close(); onClose(); }, 180);
  }
  if (!modal) return <section className={`card detail-panel-card ${open ? 'is-open' : ''}`}>
    {open && <DetailCloseButton onClick={close} />}{children}
  </section>;
  if (!open) return null;
  return <dialog ref={ref} className={`record-detail-dialog ${closing ? 'is-closing' : ''}`}
    aria-label={label} onCancel={(event) => { event.preventDefault(); close(); }}
    onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
    <DetailCloseButton onClick={close} />{children}
  </dialog>;
}
