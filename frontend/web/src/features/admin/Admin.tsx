import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { appendPage } from '../../api/pagination';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { DetailSurface } from '../../components/DetailSurface';
import { label, timeLabel } from '../../i18n/labels';

type Row = Record<string, unknown> & {
  id?: string;
  code?: string;
  name?: string;
  display_name?: string;
  username?: string;
  status?: string;
  version?: number;
};
type Page = { items: Row[]; next_cursor?: string | null };
type Detail = Row & {
  grants?: {
    id: string;
    role_code: string;
    scope_type: string;
    organization_id: string | null;
    region_code: string | null;
    revoked_at: string | null;
  }[];
  memberships?: unknown[];
};
const roles = [
  'CITIZEN',
  'VOLUNTEER',
  'COORDINATOR',
  'CAMPAIGN_MANAGER',
  'OPERATIONS_MANAGER',
  'INTAKE_STAFF',
  'REVIEWER',
  'DISTRIBUTION_STAFF',
  'ADMIN',
];
const types: Record<string, string> = {
  app_user: 'Người dùng',
  role_grant: 'Quyền truy cập',
  organization: 'Tổ chức',
  region: 'Khu vực',
};

export function Admin({ page }: { page: string }) {
  const [items, setItems] = useState<Row[]>([]);
  const [cursor, setCursor] = useState('');
  const [next, setNext] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [auditType, setAuditType] = useState('app_user');
  const [query, setQuery] = useState('');
  const listPath =
    page === 'regions'
      ? '/regions'
      : page === 'organizations'
        ? '/organizations'
        : page === 'audit'
          ? `/audit-logs?entity_type=${auditType}`
          : '/users';
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (query && listPath === '/users') params.set('query', query);
    const path = listPath + (params.size ? `${listPath.includes('?') ? '&' : '?'}${params}` : '');
    api<Page>('identity', path)
      .then((value) => {
        if (live) {
          setItems((current) => cursor
            ? appendPage(current, value.items, (item) => String(item.id || item.code))
            : value.items);
          setNext(value.next_cursor || null);
        }
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải danh sách.');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [listPath, cursor, query, revision]);
  useEffect(() => {
    if (!selected) return;
    if (!['users', 'grants', 'overview'].includes(page)) {
      setDetail(items.find((item) => (page === 'regions' ? item.code : item.id) === selected) || null);
      return;
    }
    let live = true;
    setDetail(null);
    api<Detail>('identity', `/users/${selected}`)
      .then((value) => {
        if (live) setDetail(value);
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải người dùng.');
      });
    return () => {
      live = false;
    };
  }, [selected, revision, page, items]);
  function success() {
    setSelected(null);
    setShowCreate(false);
    setDetail(null);
    setRevision((value) => value + 1);
  }
  const userCreate: CommandSpec = {
    title: 'Tạo người dùng',
    service: 'identity',
    path: '/users',
    fields: [
      { name: 'username', label: 'Tên đăng nhập', required: true },
      { name: 'display_name', label: 'Tên hiển thị', required: true },
      { name: 'temporary_password', label: 'Mật khẩu tạm', type: 'password', required: true, minLength: 10 },
      { name: 'organization_id', label: 'Mã tổ chức (nếu có)' },
    ],
  };
  const organizationCreate: CommandSpec = {
    title: 'Tạo tổ chức',
    service: 'identity',
    path: '/organizations',
    fields: [
      { name: 'name', label: 'Tên tổ chức', required: true },
      {
        name: 'organization_kind',
        label: 'Loại tổ chức',
        type: 'select',
        required: true,
        options: ['COORDINATION', 'VOLUNTEER', 'MILITARY', 'GOVERNMENT', 'OTHER'].map((value) => ({
          value,
          label: label(value),
        })),
      },
    ],
  };
  const regionCreate: CommandSpec = {
    title: 'Tạo khu vực',
    service: 'identity',
    path: '/regions',
    fields: [
      { name: 'code', label: 'Mã khu vực', required: true },
      { name: 'name', label: 'Tên khu vực', required: true },
    ],
  };
  const createTitle = page === 'users' ? 'Thêm người dùng' : page === 'organizations' ? 'Thêm tổ chức' : 'Thêm khu vực';
  useEffect(() => { setShowCreate(false); setSelected(null); }, [page]);
  return (
    <div className="grid-two admin-list-layout">
      <section className="card">
        <div className="section-header list-action-header">
          <h2>
            {page === 'audit'
              ? 'Lịch sử thay đổi'
              : page === 'regions'
                ? 'Danh sách khu vực'
                : page === 'organizations'
                  ? 'Danh sách tổ chức'
                  : 'Danh sách người dùng'}
          </h2>
          {['users', 'organizations', 'regions'].includes(page) && (
            <button type="button" className="button primary list-create-button" onClick={() => setShowCreate(true)}>
              {page === 'users' && <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M10 3v14M3 10h14" /></svg>}
              {createTitle}
            </button>
          )}
        </div>
        {page === 'audit' && (
          <label className="filter">
            Loại đối tượng
            <select
              value={auditType}
              onChange={(event) => {
                setAuditType(event.target.value);
                setCursor('');
              }}
            >
              <option value="app_user">Người dùng</option>
              <option value="role_grant">Quyền truy cập</option>
              <option value="organization">Tổ chức</option>
              <option value="region">Khu vực</option>
            </select>
          </label>
        )}
        {['users', 'grants'].includes(page) && (
          <label className="filter">
            Tìm theo tiền tố tên
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor('');
              }}
              placeholder="Tên đăng nhập hoặc tên hiển thị"
            />
          </label>
        )}
        {loading && <p role="status">Đang tải…</p>}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {!loading && !items.length && !error && <div className="empty">{page === 'audit' ? 'Chưa có thay đổi nào thuộc loại đã chọn.' : 'Chưa có dữ liệu để hiển thị.'}</div>}
        <div className={`record-list ${page === 'audit' ? '' : 'admin-record-list'}`}>
          {items.map((item, index) => {
            const canOpen = ['users', 'grants', 'overview', 'organizations', 'regions'].includes(page) && Boolean(item.id || item.code);
            const title = page === 'audit'
              ? label(item.action)
              : item.display_name || item.name || item.username || 'Bản ghi';
            if (canOpen) return (
              <button type="button" className="admin-record-card" key={item.id || item.code || index}
                onClick={() => setSelected(item.id || item.code || null)} aria-label={`${String(title)}${item.status ? `, ${label(item.status)}` : ''}, xem chi tiết`}>
                <span className="admin-record-heading">
                  <strong>{String(title)}</strong>
                  {item.status && <span className={`admin-record-status ${item.status === 'ACTIVE' ? 'is-active' : 'is-inactive'}`}>
                    <span className="admin-status-dot" aria-hidden="true" />{label(item.status)}
                  </span>}
                </span>
                {item.username && <span className="admin-record-username">{item.username}</span>}
                {Boolean(item.created_at) && <small>{timeLabel(item.created_at)}</small>}
              </button>
            );
            return <article className="record" key={item.id || item.code || index}>
              <div>
                <strong>{title}</strong>
                {item.username && <p>{item.username}</p>}
                {page === 'audit' && (
                  <>
                    <p>
                      {types[String(item.entity_type)] || 'Đối tượng'} ·{' '}
                      {String(item.entity_id || '')}
                    </p>
                    {Boolean(item.reason) && <p>Lý do: {String(item.reason)}</p>}
                  </>
                )}
                {item.status && <span className="chip">{label(item.status)}</span>}
                {Boolean(item.created_at) && <small>{timeLabel(item.created_at)}</small>}
              </div>
            </article>
          })}
        </div>
        {next && (
          <button className="button secondary" onClick={() => setCursor(next)}>
            Xem thêm
          </button>
        )}
      </section>
      <DetailSurface modal open={Boolean(selected) || showCreate} onClose={() => { setSelected(null); setDetail(null); setShowCreate(false); }} label={selected ? 'Chi tiết bản ghi' : createTitle} className={showCreate && page === 'users' ? 'admin-create-dialog' : ''}>
        {showCreate && page === 'users' && (
          <div className="admin-create-brand">
            <span className="auth-logo-frame"><img src="/reliva-logo.png" alt="" /></span>
            <span className="admin-create-brand-copy"><strong>Reliva</strong><small>QUẢN TRỊ NGƯỜI DÙNG</small></span>
          </div>
        )}
        {selected && <h2>
          {selected
            ? page === 'users' ? 'Chi tiết người dùng' : page === 'organizations' ? 'Chi tiết tổ chức' : 'Chi tiết khu vực'
            : page === 'users' ? 'Thêm người dùng'
              : page === 'organizations' ? 'Thêm tổ chức'
                : page === 'regions' ? 'Thêm khu vực'
                  : 'Thông tin quản trị'}
        </h2>}
        {selected && !detail && <p role="status">Đang tải chi tiết…</p>}
        {detail && (
          <>
            <p>
              <strong>{detail.display_name || detail.name}</strong>{' '}
              {detail.username ? `· ${detail.username}` : ''}
            </p>
            <div className="admin-record-meta">
              <span className="admin-version-badge">V{detail.version}</span>
              <span className={`admin-status-badge ${detail.status === 'ACTIVE' ? 'is-active' : ''}`}>
                <span className="admin-status-dot" aria-hidden="true" />{label(detail.status)}
              </span>
            </div>
            {!['organizations', 'regions'].includes(page) && (
              <>
                <h3>Quyền hiện có</h3>
                {detail.grants?.length ? (
                  detail.grants.map((grant) => (
                    <div className="candidate" key={grant.id}>
                      <p>
                        {label(grant.role_code)} · {label(grant.scope_type)}{' '}
                        {grant.region_code || ''} {grant.revoked_at ? '(đã thu hồi)' : ''}
                      </p>
                      {page === 'users' && !grant.revoked_at && (
                        <CommandForm
                          spec={{
                            title: 'Thu hồi quyền',
                            service: 'identity',
                            path: `/grants/${grant.id}/revoke`,
                            warning: `Thu hồi quyền ${label(grant.role_code)} của ${detail.username}?`,
                            fields: [
                              {
                                name: 'reason',
                                label: 'Lý do thu hồi',
                                type: 'textarea',
                                required: true,
                              },
                            ],
                          }}
                          onSuccess={success}
                        />
                      )}
                    </div>
                  ))
                ) : (
                  <p>Chưa có quyền được cấp.</p>
                )}
              </>
            )}
            <div className="action-grid">
              {['users', 'grants', 'overview'].includes(page) && detail.status === 'ACTIVE' && (
                <CommandForm
                  spec={{
                    title: 'Vô hiệu hóa người dùng',
                    service: 'identity',
                    path: `/users/${detail.id}/disable`,
                    version: detail.version,
                    warning: `Vô hiệu hóa tài khoản ${detail.username}? Các phiên sẽ bị thu hồi.`,
                    fields: [{ name: 'reason', label: 'Lý do', type: 'textarea', required: true }],
                  }}
                  onSuccess={success}
                />
              )}
              {['users', 'grants', 'overview'].includes(page) && detail.status === 'DISABLED' && (
                <CommandForm
                  spec={{
                    title: 'Kích hoạt người dùng',
                    service: 'identity',
                    path: `/users/${detail.id}/enable`,
                    version: detail.version,
                    warning: `Kích hoạt tài khoản ${detail.username}?`,
                    fields: [{ name: 'reason', label: 'Lý do', type: 'textarea', required: true }],
                  }}
                  onSuccess={success}
                />
              )}
              {page === 'users' && (
                <CommandForm
                  spec={{
                    title: 'Đặt lại mật khẩu tạm',
                    service: 'identity',
                    path: `/users/${detail.id}/reset-password`,
                    version: detail.version,
                    warning: `Đặt lại mật khẩu của ${detail.username}? Phiên hiện tại của người này sẽ bị thu hồi.`,
                    fields: [
                      {
                        name: 'temporary_password',
                        label: 'Mật khẩu tạm mới',
                        type: 'password',
                        required: true,
                        minLength: 10,
                      },
                      { name: 'reason', label: 'Lý do', type: 'textarea', required: true },
                    ],
                  }}
                  onSuccess={success}
                />
              )}
              {page === 'organizations' && detail.status === 'ACTIVE' && detail.version != null && (
                <CommandForm
                  spec={{
                    title: 'Ngừng hoạt động tổ chức',
                    service: 'identity',
                    path: `/organizations/${detail.id}/deactivate`,
                    version: detail.version,
                    warning: `Ngừng hoạt động tổ chức ${detail.name}?`,
                    fields: [{ name: 'reason', label: 'Lý do', type: 'textarea', required: true }],
                  }}
                  onSuccess={success}
                />
              )}
              {page === 'regions' && detail.code && detail.status === 'ACTIVE' && detail.version != null && (
                <CommandForm
                  spec={{
                    title: 'Ngừng hoạt động khu vực',
                    service: 'identity',
                    path: `/regions/${encodeURIComponent(detail.code)}/deactivate`,
                    version: detail.version,
                    warning: `Ngừng hoạt động khu vực ${detail.name || detail.code}?`,
                    fields: [{ name: 'reason', label: 'Lý do', type: 'textarea', required: true, maxLength: 500 }],
                  }}
                  onSuccess={success}
                />
              )}
              {page === 'users' && (
                <CommandForm
                  spec={{
                    title: 'Cấp quyền',
                    service: 'identity',
                    path: `/users/${detail.id}/grants`,
                    warning: `Cấp quyền cho ${detail.username}? Phiên hiện tại của người này sẽ bị thu hồi.`,
                    fields: [
                      {
                        name: 'role_code',
                        label: 'Vai trò',
                        type: 'select',
                        required: true,
                        options: roles.map((value) => ({ value, label: label(value) })),
                        resetOnChange: ['scope_type', 'organization_id', 'region_code', 'campaign_id'],
                      },
                      {
                        name: 'scope_type',
                        label: 'Phạm vi',
                        type: 'select',
                        required: true,
                        optionsFor: (values) => (
                          values.role_code === 'ADMIN' ? ['SYSTEM']
                            : ['CITIZEN', 'VOLUNTEER'].includes(values.role_code)
                              ? ['SYSTEM', 'ORGANIZATION']
                              : values.role_code ? ['ORGANIZATION', 'REGION', 'CAMPAIGN'] : []
                        ).map((value) => ({ value, label: label(value) })),
                        resetOnChange: ['organization_id', 'region_code', 'campaign_id'],
                      },
                      { name: 'organization_id', label: 'Mã tổ chức', required: true, visibleWhen: { field: 'scope_type', value: 'ORGANIZATION' } },
                      { name: 'region_code', label: 'Mã khu vực', required: true, visibleWhen: { field: 'scope_type', value: 'REGION' } },
                      { name: 'campaign_id', label: 'Mã chiến dịch', required: true, visibleWhen: { field: 'scope_type', value: 'CAMPAIGN' } },
                      { name: 'reason', label: 'Lý do', type: 'textarea', required: true },
                    ],
                  }}
                  onSuccess={success}
                />
              )}
            </div>
          </>
        )}
        {!selected && page === 'users' && <CommandForm spec={userCreate} onSuccess={success} />}
        {!selected && page === 'organizations' && (
          <CommandForm spec={organizationCreate} onSuccess={success} />
        )}
        {!selected && page === 'regions' && <CommandForm spec={regionCreate} onSuccess={success} />}
        {!selected && page === 'grants' && <p>Chọn người dùng để xem và cấp quyền theo phạm vi.</p>}
        {!selected && page === 'audit' && (
          <p>
            Chỉ tài khoản được cấp quyền mới xem được lý do và nội dung thay đổi.
          </p>
        )}
        {!selected && page === 'overview' && (
          <p>
            Danh sách người dùng trong phạm vi được cấp quyền. Chọn một tài khoản để xem trạng thái
            và quyền hiện tại.
          </p>
        )}
      </DetailSurface>
    </div>
  );
}
