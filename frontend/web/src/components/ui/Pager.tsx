
/** Prev/next pager for cursor pagination (total is unknown by design). */
export function Pager({ page, hasNext, loading, onPrev, onNext, noun = 'mục', count }: {
  page: number; hasNext: boolean; loading?: boolean; onPrev: () => void; onNext: () => void; noun?: string; count: number;
}) {
  if (page === 0 && !hasNext) return count ? <p className="pager-summary">{count} {noun}</p> : null;
  return <nav className="pager" aria-label="Phân trang">
    <span className="pager__info">Trang <strong>{page + 1}</strong> · {count} {noun}</span>
    <div className="pager__buttons">
      <button type="button" className="pager__btn" disabled={page === 0 || loading} onClick={onPrev}>‹ Trang trước</button>
      <button type="button" className="pager__btn" disabled={!hasNext || loading} onClick={onNext}>Trang sau ›</button>
    </div>
  </nav>;
}

/** Compact prev/next bar for lists navigated with useCursorNav. */
export function ListNav({ page, hasNext, loading, onPrev, onNext, count, noun = 'mục' }: {
  page: number; hasNext: boolean; loading?: boolean; onPrev: () => void; onNext: () => void; count: number; noun?: string;
}) {
  if (page === 0 && !hasNext) return null;
  return <Pager page={page} hasNext={hasNext} loading={loading} onPrev={onPrev} onNext={onNext} count={count} noun={noun} />;
}

export function LoadMore({ hasMore, loading, onClick, shown, noun = 'mục' }: {
  hasMore: boolean; loading?: boolean; onClick: () => void; shown: number; noun?: string;
}) {
  return <div className="load-more">
    <span className="pager__info">Đang hiển thị {shown} {noun}</span>
    {hasMore && <button type="button" className="pager__btn" disabled={loading} onClick={onClick}>{loading ? 'Đang tải…' : 'Tải thêm'}</button>}
  </div>;
}
