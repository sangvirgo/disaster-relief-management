import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Service } from './client';

type PageBody<T> = { items: T[]; next_cursor?: string | null; cursor?: string | null; more?: boolean };

/**
 * Server-side pagination: one request per page, never the whole collection.
 * Cursors of visited pages are remembered so the user can go back without a refetch of earlier pages' cursors.
 */
export function useCursorPages<T>(service: Service, path: string, pageSize = 10, enabled = true) {
  const [items, setItems] = useState<T[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const cursors = useRef<string[]>(['']);

  useEffect(() => { cursors.current = ['']; setPageIndex(0); }, [service, path, pageSize]);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let live = true;
    setLoading(true); setError('');
    const cursor = cursors.current[pageIndex] || '';
    const query = new URLSearchParams({ limit: String(pageSize) });
    if (cursor) query.set('cursor', cursor);
    api<PageBody<T>>(service, `${path}${path.includes('?') ? '&' : '?'}${query}`)
      .then((body) => {
        if (!live) return;
        const next = body.next_cursor || (body.more ? body.cursor || '' : '');
        cursors.current[pageIndex + 1] = next || '';
        cursors.current.length = pageIndex + 2;
        setItems(body.items); setHasNext(Boolean(next));
      })
      .catch((cause) => { if (live) { setItems([]); setHasNext(false); setError(cause instanceof Error ? cause.message : 'Không thể tải danh sách.'); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [service, path, pageSize, pageIndex, revision, enabled]);

  const next = useCallback(() => { if (hasNext) setPageIndex((value) => value + 1); }, [hasNext]);
  const prev = useCallback(() => setPageIndex((value) => Math.max(0, value - 1)), []);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const first = useCallback(() => { cursors.current = ['']; setPageIndex(0); setRevision((value) => value + 1); }, []);
  return { items, page: pageIndex, hasNext, loading, error, next, prev, reload, first };
}

/** Accumulating variant for "Tải thêm" lists. */
export function useLoadMore<T>(service: Service, path: string, pageSize = 20, enabled = true) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState('');
  const [nextCursor, setNextCursor] = useState('');
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => { setItems([]); setCursor(''); setNextCursor(''); }, [service, path, pageSize, revision]);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let live = true;
    setLoading(true); setError('');
    const query = new URLSearchParams({ limit: String(pageSize) });
    if (cursor) query.set('cursor', cursor);
    api<PageBody<T>>(service, `${path}${path.includes('?') ? '&' : '?'}${query}`)
      .then((body) => {
        if (!live) return;
        setItems((current) => (cursor ? [...current, ...body.items] : body.items));
        setNextCursor(body.next_cursor || (body.more ? body.cursor || '' : '') || '');
      })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải danh sách.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [service, path, pageSize, cursor, enabled, revision]);

  return {
    items, loading, error, hasMore: Boolean(nextCursor),
    loadMore: () => { if (nextCursor && !loading) setCursor(nextCursor); },
    reload: () => setRevision((value) => value + 1),
  };
}
