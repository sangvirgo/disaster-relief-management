import { Dropdown } from '../../components/ui/Dropdown';
import { useEffect, useId, useState } from 'react';
import type { Me } from '../../auth/session';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { timeLabel } from '../../i18n/labels';
import { readPickup } from './pickupCommands';
import { PickupTicketPanel } from './PickupTicketPanel';
import { permissionsForRoles, type PickupTicket, type PickupTicketList } from './pickupRules';
import { pickupErrorMessage, pickupStatusLabels, pickupStatusTone, type PickupStatus } from './pickupCopy';
import './pickup.css';

const STATUS_FILTERS: { value: '' | PickupStatus; label: string }[] = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'OPEN', label: 'Mới tạo' },
  { value: 'READY', label: 'Sẵn sàng' },
  { value: 'HANDED_OVER', label: 'Đã bàn giao' },
  { value: 'CLOSED', label: 'Đã đóng' },
  { value: 'CANCELLED', label: 'Đã hủy' },
];

/** Operations view of pickup tickets: a filterable list with the selected ticket's panel beside it. */
export function PickupTicketsPage({ user }: { user: Me }) {
  const filterId = useId();
  const granted = permissionsForRoles(user.grants.map((grant) => grant.role_code));
  const canView = granted.has('PICKUP_TICKET_VIEW');
  const [status, setStatus] = useState<'' | PickupStatus>('');
  const [items, setItems] = useState<PickupTicket[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [previousCursors, setPreviousCursors] = useState<(string | null)[]>([]);
  const [more, setMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => new URL(window.location.href).searchParams.get('ticket_id'));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const restore = () => setSelectedId(new URL(window.location.href).searchParams.get('ticket_id'));
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  function openTicket(id: string | null) {
    setSelectedId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('ticket_id', id);
    else url.searchParams.delete('ticket_id');
    window.history.pushState(null, '', url);
  }

  useEffect(() => {
    if (!canView) return;
    let live = true;
    setLoading(true);
    setError('');
    setItems([]);
    setCursor(null);
    setMore(false);
    const query = new URLSearchParams({ limit: '25' });
    if (status) query.set('status', status);
    if (pageCursor) query.set('cursor', pageCursor);
    readPickup<PickupTicketList>(`/pickup-tickets?${query}`)
      .then((page) => {
        if (!live) return;
        setItems(page.items as PickupTicket[]);
        setCursor(page.more ? page.cursor ?? null : null);
        setMore(Boolean(page.more));
      })
      .catch((cause) => { if (live) { setItems([]); setMore(false); setError(pickupErrorMessage(cause, 'load')); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [canView, status, pageCursor, revision]);

  function nextPage() {
    if (!cursor) return;
    setPreviousCursors((current) => [...current, pageCursor]);
    setPageCursor(cursor);
  }

  function previousPage() {
    const previous = previousCursors.at(-1);
    setPageCursor(previous ?? null);
    setPreviousCursors((current) => current.slice(0, -1));
  }

  if (!canView) {
    return (
      <section className="card pickup-page" aria-labelledby={`${filterId}-title`}>
        <h2 id={`${filterId}-title`}>Phiếu lấy hàng</h2>
        <EmptyState icon="lock" title="Chưa có quyền xem phiếu lấy hàng"
          description="Màn hình này dành cho điều phối viên và quản lý vận hành." />
      </section>
    );
  }

  return (
    <div className="pickup-page">
      <section className="card pickup-list-card" aria-labelledby={`${filterId}-title`}>
        <div className="pickup-list-card__header">
          <h2 id={`${filterId}-title`}>Phiếu lấy hàng theo nhiệm vụ</h2>
          <div className="pickup-field pickup-field--inline">
            <label htmlFor={`${filterId}-status`}>Trạng thái</label>
            <Dropdown id={`${filterId}-status`} value={status} onChange={(event) => { setStatus(event.target.value as '' | PickupStatus); setPageCursor(null); setPreviousCursors([]); openTicket(null); }}>
              {STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Dropdown>
          </div>
        </div>

        {loading && items.length === 0 && <Skeleton rows={5} label="Đang tải danh sách phiếu lấy hàng…" />}

        {error && (
          <div className="notice error pickup-notice" role="alert">
            <p>{error}</p>
            <Button variant="secondary" size="sm" onClick={() => setRevision((value) => value + 1)}>Thử lại</Button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <EmptyState title="Chưa có phiếu lấy hàng" description="Phiếu được lập khi nhiệm vụ đã có đội nhận và có nhu cầu hàng hóa." />
        )}

        {items.length > 0 && (
          <ul className="pickup-list" aria-label="Danh sách phiếu lấy hàng">
            {items.map((ticket) => (
              <li key={ticket.id}>
                <button type="button" className={`pickup-row${selectedId === ticket.id ? ' is-selected' : ''}`}
                  aria-pressed={selectedId === ticket.id} onClick={() => openTicket(ticket.id)}>
                  <span className="pickup-row__title">Nhiệm vụ …{ticket.mission_id.slice(-8)}</span>
                  <Badge tone={pickupStatusTone[ticket.status]} title={pickupStatusLabels[ticket.status]}>{pickupStatusLabels[ticket.status]}</Badge>
                  <span className="pickup-row__meta">{ticket.lines.length} mặt hàng · Cập nhật {timeLabel(ticket.updated_at)}</span>
                  {ticket.unaccounted_goods && <Badge tone="warning" kind="meta">Chưa đối soát</Badge>}
                  {ticket.handover_overdue && <Badge tone="danger" kind="meta">Quá hạn bàn giao</Badge>}
                </button>
              </li>
            ))}
          </ul>
        )}

        {(more || previousCursors.length > 0) && <nav className="pickup-form-actions" aria-label="Phân trang phiếu lấy hàng">
          <span>Trang {previousCursors.length + 1}</span>
          <Button variant="secondary" size="sm" disabled={loading || previousCursors.length === 0} onClick={previousPage}>‹ Trang trước</Button>
          <Button variant="secondary" size="sm" disabled={loading || !more || !cursor} onClick={nextPage}>Trang sau ›</Button>
        </nav>}
      </section>

      {selectedId ? (
        <div className="pickup-detail-page">
          <Button variant="secondary" size="sm" onClick={() => openTicket(null)}>← Danh sách phiếu</Button>
          <PickupTicketPanel key={selectedId} user={user} ticketId={selectedId} headingLevel={2}
            onChanged={() => setRevision((value) => value + 1)} />
        </div>
      ) : (
        null
      )}
    </div>
  );
}
