import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useCursorNav, LIST_PAGE_SIZE } from '../../api/useCursorNav';
import { ListNav } from '../../components/ui/Pager';
import type { Me } from '../../auth/session';
import { GoogleLink } from '../../auth/GoogleLink';
import { label, requestStatusLabel, timeLabel } from '../../i18n/labels';

type OwnedRequest = {
  id: string;
  tracking_code: string;
  status: string;
  received_at: string;
};
type OwnedPage = { items: OwnedRequest[]; more: boolean; cursor?: string };

export function requestStatusTone(status: string): string {
  if (['REJECTED', 'CANCELLED', 'DUPLICATE'].includes(status)) return 'danger';
  if (['RESOLVED', 'CLOSED'].includes(status)) return 'success';
  if (['DISPATCHED', 'IN_PROGRESS'].includes(status)) return 'progress';
  if (['TRIAGED', 'VERIFIED'].includes(status)) return 'priority';
  return 'pending';
}

export function CitizenRequests({
  user,
  onTrack,
  onNewSos,
  onManualLookup,
}: {
  user: Me;
  onTrack: (code: string) => void;
  onNewSos?: () => void;
  onManualLookup?: () => void;
}) {
  const [items, setItems] = useState<OwnedRequest[]>([]);
  const [cursor, setCursor, prevPage, pageIndex] = useCursorNav<string>('');
  const [next, setNext] = useState('');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api<OwnedPage>(
      'response',
      `/requests/mine?limit=${LIST_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    )
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setNext(result.more ? result.cursor || '' : '');
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Không thể tải yêu cầu của bạn.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [cursor, revision, user.id]);

  function refresh() {
    setCursor('');
    setRevision((value) => value + 1);
  }

  return (
    <section className="card account-requests">
      <div className="section-header">
        <div>
          <span className="eyebrow">SOS cá nhân</span>
          <h2>Danh sách yêu cầu</h2>
        </div>
        <button className="button secondary" type="button" onClick={refresh} disabled={loading}>
          Cập nhật danh sách
        </button>
      </div>
      <p>Chọn một yêu cầu để xem tiến độ. Những SOS đã gắn với tài khoản không cần nhập mã.</p>
      {loading && <p role="status">Đang tải yêu cầu…</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {!loading && !error && !items.length && (
        <div className="empty">
          <p>Bạn chưa có yêu cầu SOS nào gắn với tài khoản.</p>
          {onNewSos && <button className="button" type="button" onClick={onNewSos}>Gửi yêu cầu SOS</button>}
        </div>
      )}
      <div className="account-request-list">
        {items.map((item) => (
          <button className="account-request" type="button" key={item.id}
            onClick={() => onTrack(item.tracking_code)}
            aria-label={`Xem tiến độ SOS ${item.tracking_code}, ${requestStatusLabel(item.status)}`}>
            <div>
              <strong>{item.tracking_code}</strong>
              <small>Tiếp nhận {timeLabel(item.received_at)}</small>
            </div>
            <span className={`chip request-status request-status--${requestStatusTone(item.status)}`}>
              {requestStatusLabel(item.status)}
            </span>
            <span className="account-request-arrow" aria-hidden="true">›</span>
          </button>
        ))}
      </div>
      <ListNav page={pageIndex} hasNext={Boolean(next)} loading={loading} onPrev={prevPage} onNext={() => next && setCursor(next)} count={items.length} noun="yêu cầu" />
      {onManualLookup && (
        <button className="text-button account-manual-lookup" type="button" onClick={onManualLookup}>
          Có SOS đã gửi khi chưa đăng nhập? Tra cứu bằng mã
        </button>
      )}
    </section>
  );
}

export function CitizenAccount({
  user,
  onChangePassword,
}: {
  user: Me;
  onChangePassword: () => void;
}) {
  const roleNames = [...new Set(user.grants.map((grant) => label(grant.role_code)))];
  return (
    <div className="account-layout account-layout--profile-only">
      <section className="card account-profile">
        <span className="eyebrow">Hồ sơ của bạn</span>
        <h2>{user.display_name}</h2>
        <dl className="account-facts">
          <div><dt>Tên đăng nhập</dt><dd>{user.username}</dd></div>
          <div><dt>Vai trò được cấp</dt><dd>{roleNames.join(', ') || 'Người dân'}</dd></div>
        </dl>
        <div className="account-actions">
          {!user.must_change_password && (
            <button type="button" className="button secondary" onClick={onChangePassword}>Đổi mật khẩu</button>
          )}
        </div>
        <p className="account-hint">Các không gian làm việc xuất hiện theo vai trò được cấp cho tài khoản.</p>
      </section>
      {!user.must_change_password && <GoogleLink key={user.id} user={user} />}
    </div>
  );
}
