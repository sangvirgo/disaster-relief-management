import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Service } from '../api/client';
import { LIST_PAGE_SIZE, useCursorNav } from '../api/useCursorNav';
import { timeLabel } from '../i18n/labels';
import { DetailSurface } from './DetailSurface';
import { ListNav } from './ui/Pager';
import './evidence-gallery.css';

export type EvidenceMedia = { id: string; state: string; size_bytes: number; detected_mime?: string; created_at: string };

/** Signed URLs stay in memory. Opening a gallery loads the media; viewing it never requires a separate link command. */
export function EvidenceGallery({ items, service = 'response' }: { items: EvidenceMedia[]; service?: Service }) {
  const [cursor, setCursor, prev, page] = useCursorNav<string>('');
  const start = Number(cursor || 0);
  const shown = items.slice(start, start + LIST_PAGE_SIZE);
  useEffect(() => { if (start >= items.length && start > 0) setCursor(''); }, [items.length, start, setCursor]);
  return <div>
    <div className="evidence-gallery">{shown.map(item => <EvidencePreview key={item.id} item={item} service={service} />)}</div>
    <ListNav page={page} count={shown.length} noun="minh chứng" hasNext={start + LIST_PAGE_SIZE < items.length} onPrev={prev} onNext={() => setCursor(String(start + LIST_PAGE_SIZE))} />
  </div>;
}

function EvidencePreview({ item, service }: { item: EvidenceMedia; service: Service }) {
  const [media, setMedia] = useState<{ url: string; loadedAt: number } | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const generation = useRef(0);
  const refreshedAfterError = useRef(false);
  const load = useCallback(async () => {
    const attempt = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const result = await api<{ url: string }>(service, `/evidence/${encodeURIComponent(item.id)}/download`);
      if (generation.current === attempt) { setMedia({ url: result.url, loadedAt: Date.now() }); setError(''); }
    } catch (cause) {
      if (generation.current === attempt) setError(cause instanceof Error ? cause.message : 'Chưa tải được minh chứng.');
    } finally { if (generation.current === attempt) setLoading(false); }
  }, [service, item.id]);
  useEffect(() => {
    if (item.state === 'READY') void load();
    return () => { generation.current++; };
  }, [load, item.state]);
  const video = item.detected_mime === 'video/mp4';
  function mediaFailed() {
    // A URL may have expired before a lazy image or video range request starts. Retry once, never loop.
    if (!refreshedAfterError.current) { refreshedAfterError.current = true; void load(); }
    else setError('Không mở được minh chứng. Hãy thử tải lại.');
  }
  function open() {
    setExpanded(true);
    if (!media || Date.now() - media.loadedAt > 50_000) void load();
  }
  const preview = media && !error && (video
    ? <video key={media.url} src={media.url} controls preload="metadata" aria-label="Video minh chứng hiện trường" onError={mediaFailed} />
    : <button type="button" className="evidence-gallery__image" onClick={open} aria-label="Phóng to ảnh minh chứng"><img src={media.url} alt="Ảnh minh chứng hiện trường" onError={mediaFailed} /><span>Phóng to ảnh</span></button>);
  return <figure className="evidence-gallery__item">
    {preview}
    {loading && <p role="status">Đang tải minh chứng…</p>}
    {item.state !== 'READY' && <p role="status">Minh chứng đang được xử lý.</p>}
    {error && <div role="alert"><p className="field-error">{error}</p><button type="button" className="button secondary" disabled={loading} onClick={() => { refreshedAfterError.current = false; void load(); }}>Thử tải lại</button></div>}
    <figcaption>{timeLabel(item.created_at)} · {Math.ceil(item.size_bytes / 1024)} KB</figcaption>
    {expanded && <DetailSurface modal open heading="Ảnh minh chứng" label="Xem ảnh minh chứng" className="evidence-lightbox" onClose={() => setExpanded(false)}>
      {loading ? <p role="status">Đang tải ảnh…</p> : error ? <p className="field-error" role="alert">{error}</p> : media && <img src={media.url} alt="Ảnh minh chứng hiện trường phóng to" onError={mediaFailed} />}
    </DetailSurface>}
  </figure>;
}
