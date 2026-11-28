import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DetailCloseButton } from './DetailCloseButton';
import { useModalScrollLock } from './modalScrollLock';

export function DetailSurface({ modal, open, onClose, children, label = 'Chi tiết biên nhận', className = '', heading, explicitCloseOnly = false, protectUnsaved = false, hasUnsavedChanges, canClose }: {
  label?: string; className?: string; heading?: string; modal: boolean; open: boolean; onClose: () => void; children: ReactNode; explicitCloseOnly?: boolean; protectUnsaved?: boolean; hasUnsavedChanges?: boolean;
  canClose?: () => boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [closing, setClosing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const unsaved = hasUnsavedChanges ?? dirty;
  useEffect(() => {
    if (!open) setDirty(false);
    if (!open || !protectUnsaved || !unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [open, protectUnsaved, unsaved]);
  useModalScrollLock(modal && open);
  useEffect(() => {
    if (modal && open) { setClosing(false); ref.current?.showModal(); }
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [modal, open]);
  function close() {
    if (canClose && !canClose()) return;
    if (protectUnsaved && unsaved && !window.confirm('Bạn có thay đổi chưa lưu. Đóng và bỏ các thay đổi này?')) return;
    if (!modal) { onClose(); return; }
    setClosing(true);
    timer.current = setTimeout(() => { ref.current?.close(); onClose(); }, 180);
  }
  const header = open && (heading ? <div className="detail-surface-header"><h2>{heading}</h2><DetailCloseButton onClick={close} /></div> : <DetailCloseButton onClick={close} />);
  if (!modal) return <section className={`card detail-panel-card ${open ? 'is-open' : ''} ${className}`}>
    {header}{children}
  </section>;
  if (!open) return null;
  return <dialog ref={ref} className={`record-detail-dialog ${className} ${closing ? 'is-closing' : ''}`}
    onChangeCapture={() => { if (protectUnsaved) setDirty(true); }}
    aria-label={label} onCancel={(event) => {
      if (event.target !== event.currentTarget) return;
      event.preventDefault();
      event.stopPropagation();
      if (!explicitCloseOnly) close();
    }}>
    {header}{children}
  </dialog>;
}
