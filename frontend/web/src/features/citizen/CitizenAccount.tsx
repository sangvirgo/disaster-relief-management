import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { useCursorNav, LIST_PAGE_SIZE } from '../../api/useCursorNav';
import { ListNav } from '../../components/ui/Pager';
import { isSubCoordinator, type Me } from '../../auth/session';
import { fetchAll } from '../../api/fetchAll';
import { allowedPages, allowedWorkspaces, workspaceLabels } from '../../app/catalog';
import { label, requestStatusLabel, timeLabel } from '../../i18n/labels';
import { rescueProgressMessage, type RescueProgress } from './rescueProgress';

type OwnedRequest = {
  id: string;
  tracking_code: string;
  status: string;
  received_at: string;
  rescue_progress?: RescueProgress;
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
  const [search, setSearch] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchError, setSearchError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: String(LIST_PAGE_SIZE) });
    if (cursor) params.set('cursor', cursor);
    const request = searchTerm
      ? api<OwnedPage>('response', '/requests/mine/search', {
        method: 'POST',
        body: { ...Object.fromEntries(params.entries()), q: searchTerm },
      })
      : api<OwnedPage>('response', `/requests/mine?${params}`);
    request
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
  }, [cursor, revision, searchTerm, user.id]);

  function refresh() {
    setCursor('');
    setRevision((value) => value + 1);
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const nextTerm = search.trim().toUpperCase();
    if (nextTerm && !/^[0-9A-HJKMNP-TV-Z]{10}$/.test(nextTerm)) {
      setSearchError('Mã SOS cần gồm 10 ký tự hợp lệ.');
      return;
    }
    setSearchError('');
    setItems([]);
    setNext('');
    setCursor('');
    if (nextTerm === searchTerm) setRevision((value) => value + 1);
    else setSearchTerm(nextTerm);
  }

  return (
    <section className="card account-requests">
      <div className="section-header">
        <div>
          <span className="eyebrow">SOS cá nhân</span>
          <h2>Danh sách yêu cầu</h2>
        </div>
        <button className="button secondary refresh-action" type="button" onClick={refresh} disabled={loading}>
          Làm mới danh sách
        </button>
      </div>
      <p>Chọn một yêu cầu để xem tiến độ. Những SOS đã gắn với tài khoản không cần nhập mã.</p>
      <form className="account-request-search" onSubmit={submitSearch} role="search">
        <label htmlFor="account-request-search-input">Tìm SOS theo mã SOS</label>
        <div className="account-request-search-row">
          <input id="account-request-search-input" type="search" value={search} maxLength={10}
            onChange={(event) => { setSearch(event.target.value.toUpperCase()); setSearchError(''); }} placeholder="Nhập mã SOS" autoComplete="off" aria-invalid={Boolean(searchError)} />
          <button type="submit" className="button secondary" disabled={loading}>Tìm kiếm</button>
          {searchTerm && <button type="button" className="button secondary" disabled={loading}
            onClick={() => { setSearch(''); setItems([]); setNext(''); setCursor(''); setSearchTerm(''); }}>Xóa lọc</button>}
        </div>
        {searchError && <small className="field-error" role="alert">{searchError}</small>}
      </form>
      {loading && <p role="status">Đang tải yêu cầu…</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {!loading && !error && !items.length && (
        <div className="empty">
          {searchTerm ? <><p>Không tìm thấy SOS phù hợp với mã đã nhập.</p><button className="button secondary" type="button" onClick={() => { setSearch(''); setSearchTerm(''); }}>Xóa từ khóa tìm kiếm</button></>
            : <><p>Bạn chưa có yêu cầu SOS nào gắn với tài khoản.</p>{onNewSos && <button className="button" type="button" onClick={onNewSos}>Gửi yêu cầu SOS</button>}</>}
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
              {rescueProgressMessage(item.status, item.rescue_progress) || requestStatusLabel(item.status)}
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

const ROLE_INFO: Record<string, { summary: string; tone: string }> = {
  CITIZEN: { summary: 'Gửi SOS, theo dõi tiến độ và đóng góp hàng cứu trợ.', tone: 'citizen' },
  VOLUNTEER: { summary: 'Nhận nhiệm vụ, cập nhật tiến độ và quản lý đội cứu hộ.', tone: 'volunteer' },
  COORDINATOR: { summary: 'Xác minh, ưu tiên SOS và giao đội cứu hộ trong chiến dịch.', tone: 'coordinator' },
  OPERATIONS_MANAGER: { summary: 'Quản lý kho, đợt quyên góp và giao hàng cho đội.', tone: 'operations' },
  REVIEWER: { summary: 'Duyệt độc lập biên nhận hàng quyên góp.', tone: 'operations' },
  ADMIN: { summary: 'Quản lý người dùng, quyền truy cập và lịch sử thao tác.', tone: 'admin' },
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts.at(-1)?.[0] ?? '') + (parts.length > 1 ? parts[0]![0] : '')).toUpperCase() || '?';
}

/** Profile page shared by every role: who you are, what each grant lets you do (with shortcuts), and account security. */
export function CitizenAccount({
  user,
  onChangePassword,
}: {
  user: Me;
  onChangePassword: () => void;
}) {
  const [campaignNames, setCampaignNames] = useState<Record<string, string>>({});
  const campaignIds = [...new Set(user.grants.map((grant) => grant.campaign_id).filter((id): id is string => Boolean(id)))];
  useEffect(() => {
    if (!campaignIds.length) return;
    let live = true;
    void fetchAll<{ id: string; name?: string }>('response', '/public/campaigns')
      .then((items) => { if (live) setCampaignNames(Object.fromEntries(items.filter((item) => item.name).map((item) => [item.id, item.name!]))); })
      .catch(() => undefined);
    return () => { live = false; };
    // Campaign names are a lookup for the grant list; reload only when the account changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);
  const subCoordinator = isSubCoordinator(user);
  const workspaces = allowedWorkspaces(user);
  const grants = user.grants.length ? user.grants : [{ id: 'citizen', role_code: 'CITIZEN' as const, scope_type: 'SYSTEM', campaign_id: null }];
  const scopeText = (grant: (typeof grants)[number]) => {
    if (grant.role_code === 'COORDINATOR' && grant.scope_type === 'CAMPAIGN' && !grant.campaign_id) return 'Điều phối viên phụ · tự chọn chiến dịch';
    if (grant.scope_type === 'CAMPAIGN') return `Chiến dịch: ${grant.campaign_id ? campaignNames[grant.campaign_id] ?? 'đang tải tên…' : 'chưa gắn'}`;
    return 'Toàn hệ thống';
  };
  const roleTitle = (code: string) => code === 'COORDINATOR' && subCoordinator ? 'Điều phối viên phụ' : label(code);
  return (
    <div className="account-layout account-layout--profile-only">
      <section className="card account-profile account-hero">
        <span className="account-hero__avatar" aria-hidden="true">{initials(user.display_name || user.username)}</span>
        <div className="account-hero__body">
          <span className="eyebrow">Hồ sơ của bạn</span>
          <h2>{user.display_name}</h2>
          <p className="muted">@{user.username}</p>
          <ul className="account-hero__roles" aria-label="Vai trò được cấp">
            {[...new Set(grants.map((grant) => grant.role_code))].map((code) => <li key={code} className={`account-role-chip account-role-chip--${ROLE_INFO[code]?.tone ?? 'citizen'}`}>{roleTitle(code)}</li>)}
          </ul>
        </div>
      </section>

      <div className="account-grid">
        <section className="card account-section" aria-labelledby="account-grants-title">
          <h3 id="account-grants-title">Quyền và phạm vi</h3>
          <p className="muted">Mỗi quyền mở một không gian làm việc. Liên hệ quản trị viên nếu cần thay đổi.</p>
          <ul className="account-grants">
            {grants.map((grant) => <li key={grant.id} className={`account-grant account-grant--${ROLE_INFO[grant.role_code]?.tone ?? 'citizen'}`}>
              <strong>{roleTitle(grant.role_code)}</strong>
              <span className="account-grant__scope">{scopeText(grant)}</span>
              <small>{ROLE_INFO[grant.role_code]?.summary}</small>
            </li>)}
          </ul>
        </section>

        <section className="card account-section" aria-labelledby="account-shortcuts-title">
          <h3 id="account-shortcuts-title">Lối tắt công việc</h3>
          <div className="account-shortcuts">
            {workspaces.map((workspace) => <div key={workspace} className="account-shortcut">
              <strong>{workspaceLabels[workspace]}</strong>
              <div className="account-shortcut__links">
                {allowedPages(workspace, user).slice(0, 4).map((page) => <a key={page.id} href={`?workspace=${workspace}&page=${page.id}`}>{page.title}</a>)}
              </div>
            </div>)}
          </div>
        </section>

        <section className="card account-section" aria-labelledby="account-security-title">
          <h3 id="account-security-title">Bảo mật tài khoản</h3>
          <dl className="account-facts">
            <div><dt>Tên đăng nhập</dt><dd>{user.username}</dd></div>
            <div><dt>Mật khẩu</dt><dd>{user.must_change_password ? 'Cần đổi mật khẩu tạm' : 'Đã đặt'}</dd></div>
          </dl>
          <div className="account-actions">
            {!user.must_change_password && (
              <button type="button" className="button secondary" onClick={onChangePassword}>Đổi mật khẩu</button>
            )}
          </div>
          <p className="account-hint">Không chia sẻ mật khẩu. Hãy đăng xuất khi dùng máy tính chung.</p>
        </section>
      </div>
    </div>
  );
}
