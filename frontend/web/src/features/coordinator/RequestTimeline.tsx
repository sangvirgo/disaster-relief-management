import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { label, timeLabel } from '../../i18n/labels';

type Event = {
  id: string;
  event_type: string;
  occurred_at: string;
  reason?: string | null;
};
type EventPage = { items: Event[]; more: boolean; cursor?: string };

export function RequestTimeline({ requestId, initial }: { requestId: string; initial: EventPage }) {
  const [events, setEvents] = useState(initial.items);
  const [more, setMore] = useState(initial.more);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorLoading, setCursorLoading] = useState(initial.more);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!initial.more) return;
    let live = true;
    api<EventPage>('response', `/requests/${requestId}/events`)
      .then((page) => {
        if (!live) return;
        setCursor(page.cursor ?? null);
        setMore(page.more);
        setEvents((current) => {
          const known = new Set(current.map((event) => event.id));
          return [...current, ...page.items.filter((event) => !known.has(event.id))];
        });
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải lịch sử hồ sơ.');
      })
      .finally(() => {
        if (live) setCursorLoading(false);
      });
    return () => { live = false; };
  }, [initial.more, requestId]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ cursor });
      const page = await api<EventPage>('response', `/requests/${requestId}/events?${query.toString()}`);
      setEvents((current) => {
        const known = new Set(current.map((event) => event.id));
        return [...current, ...page.items.filter((event) => !known.has(event.id))];
      });
      setCursor(page.cursor ?? null);
      setMore(page.more);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải lịch sử hồ sơ.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="request-timeline">
      <h3>Lịch sử hồ sơ</h3>
      {events.length > 0 ? (
        <div className="timeline">
          {events.map((event) => (
            <article className="timeline-item" key={event.id}>
              <strong>{label(event.event_type)}</strong> · {timeLabel(event.occurred_at)}
              {event.reason && <p>{event.reason}</p>}
            </article>
          ))}
        </div>
      ) : <p className="muted">Chưa có sự kiện trong lịch sử.</p>}
      {more && (
        <button type="button" className="button secondary" onClick={() => void loadMore()} disabled={loading || cursorLoading || !cursor}>
          {cursorLoading ? 'Đang chuẩn bị lịch sử…' : loading ? 'Đang tải lịch sử…' : 'Tải các sự kiện cũ hơn'}
        </button>
      )}
      {more && !cursor && !cursorLoading && !error && (
        <p className="notice warning">Chưa nhận được mã trang tiếp theo. Hãy tải lại hồ sơ để đồng bộ lịch sử.</p>
      )}
      {error && <p className="notice error" role="alert">{error}</p>}
    </section>
  );
}
