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
  const [items, setItems] = useState<OwnedRequest[]>([]);
  const [cursor, setCursor] = useState('');
  const [next, setNext] = useState('');
  const [loading, setLoading] = useState(false);
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
        setItems((current) => (cursor ? [...current, ...result.items] : result.items));
        setNext(result.more ? result.cursor || '' : '');
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : 'Không thể tải yêu cầu của bạn.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [cursor, user.id]);
  const roleNames = [...new Set(user.grants.map((grant) => label(grant.role_code)))];
  return (
    <div className="account-layout">
      <section className="card account-profile">
        <span className="eyebrow">Hồ sơ của bạn</span>
        <h2>{user.display_name}</h2>
        <dl className="account-facts">
          <div>
            <dt>Tên đăng nhập</dt>
            <dd>{user.username}</dd>
          </div>
          <div>
            <dt>Vai trò được cấp</dt>
            <dd>{roleNames.join(', ') || 'Người dân'}</dd>
          </div>
        </dl>
        <div className="account-actions">
          {!user.must_change_password && (
            <button type="button" className="button secondary" onClick={onChangePassword}>
              Đổi mật khẩu
            </button>
          )}
          <button type="button" className="button secondary" onClick={onLogout}>
            Đăng xuất
          </button>
        </div>
        <p className="account-hint">
          Không gian Người dân dành cho mọi tài khoản để gửi và theo dõi yêu cầu của chính mình.
          Không gian nghiệp vụ chỉ xuất hiện khi tài khoản được cấp vai trò tương ứng.
        </p>
      </section>
      <section className="card account-requests">
        <div className="section-header">
          <div>
            <span className="eyebrow">SOS cá nhân</span>
            <h2>Yêu cầu của tôi</h2>
          </div>
          <span className="chip">{items.length} yêu cầu đang hiển thị</span>
        </div>
        <p>Danh sách này chỉ gồm yêu cầu gắn với tài khoản đang đăng nhập.</p>
        {loading && <p role="status">Đang tải yêu cầu…</p>}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {!loading && !error && !items.length && (
          <div className="empty">Bạn chưa có yêu cầu SOS nào gắn với tài khoản.</div>
        )}
        <div className="account-request-list">
          {items.map((item) => (
            <article className="account-request" key={item.id}>
              <div>
                <strong>{item.tracking_code}</strong>
                <small>Tiếp nhận {timeLabel(item.received_at)}</small>
              </div>
              <span className="chip">{requestStatusLabel(item.status)}</span>
              <button className="button secondary" onClick={() => onTrack(item.tracking_code)}>
                Theo dõi
              </button>
            </article>
          ))}
        </div>
        {next && (
          <button className="button secondary" disabled={loading} onClick={() => setCursor(next)}>
            Xem thêm yêu cầu
          </button>
        )}
      </section>
    </div>
  );
}
