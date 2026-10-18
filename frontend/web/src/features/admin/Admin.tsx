import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { CommandForm, type CommandSpec } from '../../components/CommandForm';
import { label, timeLabel } from '../../i18n/labels';

type Row = Record<string, unknown> & { id?: string; code?: string; name?: string; display_name?: string; username?: string; status?: string; version?: number };
type Page = { items: Row[]; next_cursor?: string | null };
type Detail = Row & { grants?: { id: string; role_code: string; scope_type: string; organization_id: string | null; region_code: string | null; revoked_at: string | null }[]; memberships?: unknown[] };
const roles = ['CITIZEN', 'VOLUNTEER', 'COORDINATOR', 'CAMPAIGN_MANAGER', 'OPERATIONS_MANAGER', 'INTAKE_STAFF', 'REVIEWER', 'DISTRIBUTION_STAFF', 'ADMIN'];
const types: Record<string, string> = { app_user: 'Người dùng', role_grant: 'Quyền truy cập', organization: 'Tổ chức', region: 'Khu vực' };

export function Admin({ page }: { page: string }) {
  const [items, setItems] = useState<Row[]>([]); const [cursor, setCursor] = useState(''); const [next, setNext] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null); const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false); const [revision, setRevision] = useState(0);
  const [auditType, setAuditType] = useState('app_user'); const [query, setQuery] = useState('');
  const listPath = page === 'regions' ? '/regions' : page === 'organizations' ? '/organizations' : page === 'audit' ? `/audit-logs?entity_type=${auditType}` : '/users';
  useEffect(() => { let live = true; setLoading(true); setError('');
    const params = new URLSearchParams(); if (cursor) params.set('cursor', cursor); if (query && listPath === '/users') params.set('query', query);
    const path = listPath + (params.size ? `${listPath.includes('?') ? '&' : '?'}${params}` : '');
    api<Page>('identity', path).then((value) => { if (live) { setItems(value.items); setNext(value.next_cursor || null); } })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải danh sách.'); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; }; }, [listPath, cursor, query, revision]);
  useEffect(() => { if (!selected) return; if (!['users', 'grants', 'overview'].includes(page)) { setDetail(items.find((item) => item.id === selected) || null); return; } let live = true; setDetail(null);
    api<Detail>('identity', `/users/${selected}`).then((value) => { if (live) setDetail(value); }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải người dùng.'); });
    return () => { live = false; }; }, [selected, revision, page]);
  function success() { setSelected(null); setDetail(null); setRevision((value) => value + 1); }
  const userCreate: CommandSpec = { title: 'Tạo người dùng', service: 'identity', path: '/users', fields: [
    { name: 'username', label: 'Tên đăng nhập', required: true }, { name: 'display_name', label: 'Tên hiển thị', required: true },
    { name: 'temporary_password', label: 'Mật khẩu tạm', type: 'password', required: true }, { name: 'organization_id', label: 'Mã tổ chức (nếu có)' }] };
  const organizationCreate: CommandSpec = { title: 'Tạo tổ chức', service: 'identity', path: '/organizations', fields: [
    { name: 'name', label: 'Tên tổ chức', required: true }, { name: 'organization_kind', label: 'Loại tổ chức', type: 'select', required: true,
      options: ['COORDINATION', 'VOLUNTEER', 'MILITARY', 'GOVERNMENT', 'OTHER'].map((value) => ({ value, label: label(value) })) }] };
  const regionCreate: CommandSpec = { title: 'Tạo khu vực', service: 'identity', path: '/regions', fields: [
    { name: 'code', label: 'Mã khu vực', required: true }, { name: 'name', label: 'Tên khu vực', required: true }] };
  return <div className="grid-two"><section className="card"><h2>{page === 'audit' ? 'Nhật ký kiểm toán' : page === 'regions' ? 'Khu vực' : page === 'organizations' ? 'Tổ chức' : 'Người dùng'}</h2>
    {page === 'audit' && <label className="filter">Loại đối tượng<select value={auditType} onChange={(event) => { setAuditType(event.target.value); setCursor(''); }}><option value="app_user">Người dùng</option><option value="role_grant">Quyền truy cập</option><option value="organization">Tổ chức</option><option value="region">Khu vực</option></select></label>}
    {['users', 'grants'].includes(page) && <label className="filter">Tìm theo tiền tố tên<input value={query} onChange={(event) => { setQuery(event.target.value); setCursor(''); }} placeholder="Tên đăng nhập hoặc tên hiển thị" /></label>}
    {loading && <p role="status">Đang tải…</p>}{error && <p role="alert" className="notice error">{error}</p>}{!loading && !items.length && !error && <div className="empty">Chưa có bản ghi.</div>}
    <div className="record-list">{items.map((item, index) => <article className="record" key={item.id || item.code || index}><div><strong>{page === 'audit' ? label(item.action) : item.display_name || item.name || item.username || 'Bản ghi'}</strong>
      {item.username && <p>{item.username}</p>}{page === 'audit' && <><p>{types[String(item.entity_type)] || 'Đối tượng'} · {String(item.entity_id || '')}</p>{Boolean(item.reason) && <p>Lý do: {String(item.reason)}</p>}</>}
      {item.status && <span className="chip">{label(item.status)}</span>}{Boolean(item.created_at) && <small>{timeLabel(item.created_at)}</small>}</div>
      {['users', 'grants', 'overview', 'organizations'].includes(page) && item.id && <button className="button secondary" onClick={() => setSelected(item.id!)}>Xem chi tiết</button>}</article>)}</div>
    {next && <button className="button secondary" onClick={() => setCursor(next)}>Xem thêm</button>}</section>
    <section className="card"><h2>{selected ? 'Chi tiết và thao tác' : ['users', 'organizations', 'regions'].includes(page) ? 'Tạo bản ghi' : 'Thông tin quản trị'}</h2>
      {selected && !detail && <p role="status">Đang tải chi tiết…</p>}{detail && <><p><strong>{detail.display_name || detail.name}</strong> {detail.username ? `· ${detail.username}` : ''}</p><p>Trạng thái: {label(detail.status)} · phiên bản {detail.version}</p>
        {page !== 'organizations' && <><h3>Quyền hiện có</h3>{detail.grants?.length ? detail.grants.map((grant) => <div className="candidate" key={grant.id}><p>{label(grant.role_code)} · {label(grant.scope_type)} {grant.region_code || ''} {grant.revoked_at ? '(đã thu hồi)' : ''}</p>
          {page === 'grants' && !grant.revoked_at && <CommandForm spec={{ title: 'Thu hồi quyền', service: 'identity', path: `/grants/${grant.id}/revoke`, warning: `Thu hồi quyền ${label(grant.role_code)} của ${detail.username}?`, fields: [{ name: 'reason', label: 'Lý do thu hồi', type: 'textarea', required: true }] }} onSuccess={success} />}</div>) : <p>Chưa có quyền được cấp.</p>}</>}
        <div className="action-grid">{['users', 'grants', 'overview'].includes(page) && detail.status === 'ACTIVE' && <CommandForm spec={{ title: 'Vô hiệu hóa người dùng', service: 'identity', path: `/users/${detail.id}/disable`, version: detail.version,
          warning: `Vô hiệu hóa tài khoản ${detail.username}? Các phiên sẽ bị thu hồi.`, fields: [{ name: 'reason', label: 'Lý do', type: 'textarea', required: true }] }} onSuccess={success} />}
        {['users', 'grants', 'overview'].includes(page) && detail.status === 'DISABLED' && <CommandForm spec={{ title: 'Kích hoạt người dùng', service: 'identity', path: `/users/${detail.id}/enable`, version: detail.version,
          warning: `Kích hoạt tài khoản ${detail.username}?`, fields: [{ name: 'reason', label: 'Lý do', type: 'textarea', required: true }] }} onSuccess={success} />}
        {page === 'users' && <CommandForm spec={{ title: 'Đặt lại mật khẩu tạm', service: 'identity', path: `/users/${detail.id}/reset-password`, version: detail.version,
          warning: `Đặt lại mật khẩu của ${detail.username}? Phiên hiện tại của người này sẽ bị thu hồi.`, fields: [{ name: 'temporary_password', label: 'Mật khẩu tạm mới', type: 'password', required: true }, { name: 'reason', label: 'Lý do', type: 'textarea', required: true }] }} onSuccess={success} />}
        {page === 'organizations' && detail.status === 'ACTIVE' && detail.version != null && <CommandForm spec={{ title: 'Ngừng hoạt động tổ chức', service: 'identity', path: `/organizations/${detail.id}/deactivate`, version: detail.version,
          warning: `Ngừng hoạt động tổ chức ${detail.name}?`, fields: [{ name: 'reason', label: 'Lý do', type: 'textarea', required: true }] }} onSuccess={success} />}
        {page === 'grants' && <CommandForm spec={{ title: 'Cấp quyền', service: 'identity', path: `/users/${detail.id}/grants`, warning: `Cấp quyền cho ${detail.username}? Phiên hiện tại của người này sẽ bị thu hồi.`, fields: [
          { name: 'role_code', label: 'Vai trò', type: 'select', required: true, options: roles.map((value) => ({ value, label: label(value) })) },
          { name: 'scope_type', label: 'Phạm vi', type: 'select', required: true, options: ['SYSTEM', 'ORGANIZATION', 'REGION', 'CAMPAIGN'].map((value) => ({ value, label: label(value) })) },
          { name: 'organization_id', label: 'Mã tổ chức' }, { name: 'region_code', label: 'Mã khu vực' }, { name: 'campaign_id', label: 'Mã chiến dịch' },
          { name: 'reason', label: 'Lý do', type: 'textarea', required: true }] }} onSuccess={success} />}</div></>}
      {!selected && page === 'users' && <CommandForm spec={userCreate} onSuccess={success} />}
      {!selected && page === 'organizations' && <CommandForm spec={organizationCreate} onSuccess={success} />}
      {!selected && page === 'regions' && <CommandForm spec={regionCreate} onSuccess={success} />}
      {!selected && page === 'grants' && <p>Chọn người dùng để xem và cấp quyền theo phạm vi.</p>}
      {!selected && page === 'audit' && <p>Nhật ký chỉ hiển thị với quyền kiểm toán. Lý do và dữ liệu trước/sau cần được xem trong phạm vi quản trị được cấp.</p>}
      {!selected && page === 'overview' && <p>Danh sách người dùng trong phạm vi được cấp quyền. Chọn một tài khoản để xem trạng thái và quyền hiện tại.</p>}
      {selected && <button className="button secondary" onClick={() => { setSelected(null); setDetail(null); }}>Quay lại danh sách</button>}
    </section></div>;
}
