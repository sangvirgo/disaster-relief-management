import { useRef, useState } from 'react';
import { api, newCommandKey } from '../../api/client';
import { confirmAction } from '../../components/confirmAction';

type Membership = { organization_id: string; status: string };
type Option = { value: string; label: string };

export function AccountOrganizationMembership({ accountId, memberships, organizations, onSuccess }: {
  accountId: string; memberships: Membership[]; organizations: Option[]; onSuccess: () => void;
}) {
  const [organizationId, setOrganizationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<{ organizationId: string; key: string } | null>(null);
  const active = memberships.filter((item) => item.status === 'ACTIVE');
  const available = organizations.filter((item) => !active.some((membership) => membership.organization_id === item.value));

  async function add() {
    const organization = available.find((item) => item.value === organizationId);
    if (!organization || !(await confirmAction(`Thêm tài khoản này vào tổ chức ${organization.label}?`))) return;
    setBusy(true); setError('');
    if (pending.current?.organizationId !== organizationId)
      pending.current = { organizationId, key: newCommandKey() };
    try {
      await api('identity', `/organizations/${organizationId}/members`, {
        method: 'POST', idempotencyKey: pending.current.key, body: { user_id: accountId },
      });
      pending.current = null;
      setOrganizationId('');
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa thêm được tài khoản vào tổ chức.');
    } finally { setBusy(false); }
  }

  return <details className="admin-organization-membership">
    <summary>Tổ chức tham gia ({active.length})</summary>
    <p>Tổ chức quản lý tài khoản và đội.</p>
    {active.length ? <ul>{active.map((item) => <li key={item.organization_id}>
      {organizations.find((option) => option.value === item.organization_id)?.label || item.organization_id}
    </li>)}</ul> : <p>Chưa thuộc tổ chức nào.</p>}
    {available.length > 0 && <div className="admin-organization-add">
      <label>Tổ chức muốn thêm<select value={organizationId} onChange={(event) => { setOrganizationId(event.target.value); setError(''); pending.current = null; }}>
        <option value="">Chọn tổ chức</option>{available.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select></label>
      <button type="button" className="button secondary" disabled={!organizationId || busy} onClick={() => void add()}>
        {busy ? 'Đang thêm…' : 'Thêm vào tổ chức'}</button>
    </div>}
    {error && <p className="notice error" role="alert">{error}</p>}
  </details>;
}
