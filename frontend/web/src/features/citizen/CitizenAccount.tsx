import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { Me } from '../../auth/session';
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
  const [cursor, setCursor] = useState('');
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
      `/requests/mine${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
    )
      .then((result) => {
        if (!active) return;
        setItems((current) => cursor
          ? [...current, ...result.items.filter((item) => !current.some((existing) => existing.id === item.id))]
          : result.items);
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
          <article className="account-request" key={item.id}>
            <div>
              <strong>{item.tracking_code}</strong>
              <small>Tiếp nhận {timeLabel(item.received_at)}</small>
            </div>
            <span className={`chip request-status request-status--${requestStatusTone(item.status)}`}>
              {requestStatusLabel(item.status)}
            </span>
            <button className="button secondary" type="button" onClick={() => onTrack(item.tracking_code)}>
              Xem tiến độ
            </button>
          </article>
        ))}
      </div>
      {next && (
        <button className="button secondary" type="button" disabled={loading} onClick={() => setCursor(next)}>
          Xem thêm yêu cầu
        </button>
      )}
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
  onTrack,
  onChangePassword,
  onLogout,
}: {
  user: Me;
  onTrack: (code: string) => void;
  onChangePassword: () => void;
  onLogout: () => void;
}) {
  const roleNames = [...new Set(user.grants.map((grant) => label(grant.role_code)))];
  return (
    <div className="account-layout">
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
          <button type="button" className="button secondary" onClick={onLogout}>Đăng xuất</button>
        </div>
        <p className="account-hint">
          Không gian Người dân dành cho mọi tài khoản để gửi và theo dõi yêu cầu của chính mình.
          Không gian nghiệp vụ chỉ xuất hiện khi tài khoản được cấp vai trò tương ứng.
        </p>
      </section>
      <CitizenRequests user={user} onTrack={onTrack} />
    </div>
  );
}
