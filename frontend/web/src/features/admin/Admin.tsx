import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { appendPage } from '../../api/pagination';
import { fetchAll } from '../../api/fetchAll';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { DetailSurface } from '../../components/DetailSurface';
import { label, timeLabel } from '../../i18n/labels';
import { useUrlView } from '../../app/useUrlView';
import { auditTypes } from '../../app/routeViews';

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
    campaign_id?: string | null;
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
  const [userAction, setUserAction] = useState<'disable' | 'enable' | 'reset' | 'revoke' | null>(null);
  const [revokeGrantId, setRevokeGrantId] = useState('');
  useEffect(() => { setUserAction(null); setRevokeGrantId(''); }, [selected]);
  useEffect(() => {
    if (!userAction) return;
    const frame = requestAnimationFrame(() => document.querySelector<HTMLElement>('.admin-user-actions')?.scrollIntoView({ block: 'nearest' }));
    return () => cancelAnimationFrame(frame);
  }, [userAction]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const [auditType, setAuditType] = useUrlView('audit_type', auditTypes, 'app_user');
  useEffect(() => { setCursor(''); }, [auditType]);
  const [query, setQuery] = useState('');
  const searchTerm = query.trim();
  const queryError = page === 'users' && searchTerm.length > 64 ? 'Từ khóa tìm kiếm không được vượt quá 64 ký tự.' : '';
  const [organizationOptions, setOrganizationOptions] = useState<{ value: string; label: string }[]>([]);
  const [regionOptions, setRegionOptions] = useState<{ value: string; label: string }[]>([]);
  const listPath =
    page === 'regions'
      ? '/regions'
      : page === 'organizations'
        ? '/organizations'
        : page === 'audit'
          ? `/audit-logs?entity_type=${auditType}`
          : '/users';
  useEffect(() => {
    if (page !== 'users') return;
    let live = true;
    void fetchAll<Row>('identity', '/regions').then((regions) => {
      if (live) setRegionOptions(regions.filter(region => region.code && region.status === 'ACTIVE')
        .map(region => ({ value: region.code!, label: String(region.name || region.code) })));
    }).catch(() => { if (live) setRegionOptions([]); });
    void fetchAll<Row>('identity', '/organizations')
      .then((organizations) => {
        if (live) setOrganizationOptions(organizations
          .filter((organization) => organization.id && organization.status === 'ACTIVE')
          .map((organization) => ({ value: organization.id!, label: String(organization.name || organization.id) })));
      })
      .catch(() => { if (live) setOrganizationOptions([]); });
    return () => { live = false; };
  }, [page, revision]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    if (!cursor) { setItems([]); setNext(null); }
    if (queryError) {
      setLoading(false);
      return;
    }
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (searchTerm && listPath === '/users') params.set('query', searchTerm);
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
  }, [listPath, cursor, searchTerm, queryError, revision]);
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
    setShowCreate(false);
    setDetail(null);
    setUserAction(null);
    setRevokeGrantId('');
    setRevision((value) => value + 1);
  }
  const userCreate: CommandSpec = {
    title: 'Tạo người dùng',
    service: 'identity',
    path: '/users',
    fields: [
      { name: 'username', label: 'Tên đăng nhập', required: true, minLength: 3, maxLength: 64,
        pattern: /^[A-Za-z0-9._-]{3,64}$/,
        patternMessage: 'Tên đăng nhập cần 3–64 ký tự, chỉ gồm chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.' },
      { name: 'display_name', label: 'Tên hiển thị', required: true },
      { name: 'temporary_password', label: 'Mật khẩu tạm', type: 'password', required: true, minLength: 10 },
      { name: 'organization_id', label: 'Tổ chức (nếu có)', type: 'reference', options: organizationOptions,
        placeholder: 'Dán mã tổ chức nếu không có trong danh sách' },
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
      { name: 'code', label: 'Mã khu vực', required: true, pattern: /^[A-Z0-9_]{2,32}$/,
        patternMessage: 'Mã khu vực cần 2–32 ký tự, chỉ gồm chữ in hoa, số hoặc dấu gạch dưới.', maxLength: 32 },
      { name: 'name', label: 'Tên khu vực', required: true, maxLength: 120 },
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
              ? 'Lịch sử thao tác'
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
                setAuditType(event.target.value as typeof auditTypes[number]);
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
              aria-label="Tìm theo tiền tố tên"
              maxLength={65}
              aria-invalid={Boolean(queryError)}
              aria-describedby={queryError ? 'admin-search-error' : undefined}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor('');
              }}
              placeholder="Tên đăng nhập hoặc tên hiển thị"
            />
            {queryError && <small className="field-error" id="admin-search-error" role="alert">{queryError}</small>}
          </label>
        )}
        {loading && <p role="status">Đang tải…</p>}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {!loading && !items.length && !error && !queryError && <div className="empty">{page === 'audit' ? 'Chưa có thay đổi nào thuộc loại đã chọn.' : 'Chưa có dữ liệu để hiển thị.'}</div>}
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
      <DetailSurface modal open={Boolean(selected) || showCreate} onClose={() => { setSelected(null); setDetail(null); setShowCreate(false); setUserAction(null); setRevokeGrantId(''); }} label={selected ? 'Chi tiết bản ghi' : createTitle} className={showCreate && page === 'users' ? 'admin-create-dialog' : ''}>
        {showCreate && page === 'users' && (
          <div className="admin-create-brand">
            <span className="auth-logo-frame"><img src="/reliva-logo.png" alt="" /></span>
            <span className="admin-create-brand-copy"><strong>Reliva</strong><small>QUẢN TRỊ NGƯỜI DÙNG</small></span>
          </div>
        )}
        {selected && <div className="admin-detail-heading"><h2>
          {selected
            ? ['users', 'grants', 'overview'].includes(page) ? 'Chi tiết người dùng' : page === 'organizations' ? 'Chi tiết tổ chức' : 'Chi tiết khu vực'
            : page === 'users' ? 'Thêm người dùng'
              : page === 'organizations' ? 'Thêm tổ chức'
                : page === 'regions' ? 'Thêm khu vực'
                  : 'Thông tin quản trị'}
        </h2>{['users', 'grants', 'overview'].includes(page) && detail && <details className="admin-action-menu" key={detail.id}>
          <summary aria-label="Tác vụ người dùng" title="Tác vụ người dùng">⋯</summary>
          <div className="admin-action-options">
            <button type="button" onClick={event => { setUserAction(detail.status === 'ACTIVE' ? 'disable' : 'enable'); setRevokeGrantId(''); event.currentTarget.closest('details')?.removeAttribute('open'); }}>{detail.status === 'ACTIVE' ? 'Vô hiệu hóa người dùng' : 'Kích hoạt người dùng'}</button>
            {page === 'users' && <button type="button" onClick={event => { setUserAction('reset'); setRevokeGrantId(''); event.currentTarget.closest('details')?.removeAttribute('open'); }}>Đặt lại mật khẩu tạm</button>}
            {page === 'users' && <button type="button" disabled={!detail.grants?.some(grant => !grant.revoked_at)} onClick={event => { setUserAction('revoke'); setRevokeGrantId(''); event.currentTarget.closest('details')?.removeAttribute('open'); }}>Thu hồi quyền</button>}
          </div>
        </details>}</div>}
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
                        {grant.organization_id && <> · {organizationOptions.find(option => option.value === grant.organization_id)?.label || grant.organization_id}</>}
                        {grant.region_code && <> · {regionOptions.find(option => option.value === grant.region_code)?.label || grant.region_code}</>}
                        {grant.campaign_id && <> · Chiến dịch {grant.campaign_id}</>}
                        {grant.revoked_at ? ' (đã thu hồi)' : ''}
                      </p>
                    </div>
                  ))
                ) : (
                  <p>Chưa có quyền được cấp.</p>
                )}
              </>
            )}
            <div className="action-grid admin-user-actions">
              {page === 'users' && userAction === 'revoke' && <div className="admin-selected-action"><label>Quyền cần thu hồi<select value={revokeGrantId} onChange={event => setRevokeGrantId(event.target.value)}><option value="">Chọn quyền</option>{detail.grants?.filter(grant => !grant.revoked_at).map(grant => <option key={grant.id} value={grant.id}>{label(grant.role_code)} · {label(grant.scope_type)}{grant.region_code ? ` · ${grant.region_code}` : ''}</option>)}</select></label>{revokeGrantId && <CommandForm key={revokeGrantId} spec={{ title: 'Thu hồi quyền', service: 'identity', path: `/grants/${revokeGrantId}/revoke`, warning: `Thu hồi quyền này của ${detail.username}?`, fields: [{ name: 'reason', label: 'Lý do thu hồi', type: 'textarea', required: true, maxLength: 500 }] }} onSuccess={success} />}</div>}
              {['users', 'grants', 'overview'].includes(page) && userAction === 'disable' && detail.status === 'ACTIVE' && (
                <CommandForm
                  spec={{
                    title: 'Vô hiệu hóa người dùng',
                    service: 'identity',
                    path: `/users/${detail.id}/disable`,
                    version: detail.version,
                    warning: `Vô hiệu hóa tài khoản ${detail.username}? Các phiên sẽ bị thu hồi.`,
                    fields: [{ name: 'reason', label: 'Lý do', type: 'textarea', required: true, maxLength: 500 }],
                  }}
                  onSuccess={success}
                />
              )}
              {['users', 'grants', 'overview'].includes(page) && userAction === 'enable' && detail.status === 'DISABLED' && (
                <CommandForm
                  spec={{
                    title: 'Kích hoạt người dùng',
                    service: 'identity',
                    path: `/users/${detail.id}/enable`,
                    version: detail.version,
                    warning: `Kích hoạt tài khoản ${detail.username}?`,
                    fields: [{ name: 'reason', label: 'Lý do', type: 'textarea', required: true, maxLength: 500 }],
                  }}
                  onSuccess={success}
                />
              )}
              {page === 'users' && userAction === 'reset' && (
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
                      { name: 'reason', label: 'Lý do', type: 'textarea', required: true, maxLength: 500 },
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
                    fields: [{ name: 'reason', label: 'Lý do', type: 'textarea', required: true, maxLength: 500 }],
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
                    warningFor: (values) => {
                      const scopeDetails = [
                        values.organization_id && (organizationOptions.find(option => option.value === values.organization_id)?.label || values.organization_id),
                        values.region_code && (regionOptions.find(option => option.value === values.region_code)?.label || values.region_code),
                        values.campaign_id && `Chiến dịch ${values.campaign_id}`,
                      ].filter(Boolean).join(' · ');
                      return `Cấp quyền ${label(values.role_code)} · ${label(values.scope_type)}${scopeDetails ? ` · ${scopeDetails}` : ''} cho ${detail.username}? Phiên hiện tại của người này sẽ bị thu hồi.`;
                    },
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
                      { name: 'organization_id', label: 'Tổ chức', type: 'reference', options: organizationOptions, required: true,
                        visibleFor: values => ['ORGANIZATION', 'REGION', 'CAMPAIGN'].includes(values.scope_type), resetOnChange: ['campaign_id'] },
                      { name: 'region_code', label: 'Khu vực', type: 'select', options: regionOptions, required: true, visibleWhen: { field: 'scope_type', value: 'REGION' } },
                      { name: 'campaign_id', label: 'Chiến dịch', type: 'reference', required: true, visibleWhen: { field: 'scope_type', value: 'CAMPAIGN' }, placeholder: 'Dán mã chiến dịch do quản lý chiến dịch cung cấp' },
                      { name: 'reason', label: 'Lý do', type: 'textarea', required: true, maxLength: 500 },
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
