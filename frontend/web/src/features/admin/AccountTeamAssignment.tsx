import { useEffect, useRef, useState } from 'react';
import { api, ApiError, newCommandKey } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { confirmAction } from '../../components/confirmAction';
import './account-team-assignment.css';

type Account = {
  id: string; display_name?: string; status?: string;
  memberships?: { organization_id: string; status: string }[];
  grants?: { role_code: string; scope_type: string; organization_id: string | null; revoked_at: string | null }[];
};
type Team = { id: string; name: string; organization_id: string; reporting_mode: string; status: string; version: number };
type Member = { user_id: string; member_role: 'LEADER' | 'MEMBER' };
type Organization = { id: string; name: string };

export function AccountTeamAssignment({ account }: { account: Account }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [assigned, setAssigned] = useState<{ team: Team; role: Member['member_role'] } | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState('');
  const [memberOrganizationIds, setMemberOrganizationIds] = useState<string[]>(() =>
    account.memberships?.filter((item) => item.status === 'ACTIVE').map((item) => item.organization_id) || []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const pending = useRef<{ action: string; key: string } | null>(null);
  const volunteerIn = (organizationId: string) => Boolean(account.grants?.some((grant) => !grant.revoked_at && grant.role_code === 'VOLUNTEER' &&
    (grant.scope_type === 'SYSTEM' || (grant.scope_type === 'ORGANIZATION' && grant.organization_id === organizationId))));
  const choices = teams.filter((team) => team.status === 'ACTIVE' && team.reporting_mode === 'APP' && volunteerIn(team.organization_id));
  const selected = assigned?.team || choices.find((team) => team.id === selectedTeamId);
  const organizationName = (id: string) => organizations.find((item) => item.id === id)?.name || id;
  const hasOrganization = selected ? memberOrganizationIds.includes(selected.organization_id) : false;
  const ready = !loading && (!error || teams.length > 0);

  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    void Promise.all([fetchAll<Team>('response', '/teams'), fetchAll<Organization>('identity', '/organizations')]).then(async ([teamRows, organizationRows]) => {
      const rosters = await Promise.all(teamRows.map((team) => fetchAll<Member>('response', `/teams/${team.id}/members`)));
      if (!live) return;
      setTeams(teamRows); setOrganizations(organizationRows);
      const index = rosters.findIndex((members) => members.some((member) => member.user_id === account.id));
      const member = index < 0 ? undefined : rosters[index].find((item) => item.user_id === account.id);
      setAssigned(index >= 0 && member ? { team: teamRows[index], role: member.member_role } : null);
    }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Chưa tải được đội của tài khoản.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [account.id, revision]);

  async function run(action: 'organization' | 'add' | 'leader', team: Team) {
    const name = account.display_name || 'tài khoản này';
    const description = action === 'organization'
      ? `Thêm ${name} vào tổ chức ${organizationName(team.organization_id)}?`
      : action === 'add' ? `Gắn ${name} vào ${team.name} với vai trò thành viên?`
        : `Giao vai trò đội trưởng ${team.name} cho ${name}? Đội trưởng hiện tại sẽ trở thành thành viên.`;
    if (!(await confirmAction(description))) return;
    setBusy(true); setError(''); setMessage('');
    const scope = `${action}:${team.id}:${account.id}`;
    if (pending.current?.action !== scope) pending.current = { action: scope, key: newCommandKey() };
    try {
      if (action === 'organization') {
        await api('identity', `/organizations/${team.organization_id}/members`, { method: 'POST', idempotencyKey: pending.current.key,
          body: { user_id: account.id } });
        setMemberOrganizationIds((ids) => [...new Set([...ids, team.organization_id])]);
        setMessage('Đã thêm vào tổ chức. Tiếp theo, gắn tài khoản vào đội.');
      } else if (action === 'add') {
        await api('response', `/teams/${team.id}/members`, { method: 'POST', idempotencyKey: pending.current.key,
          body: { user_id: account.id } });
        setAssigned({ team, role: 'MEMBER' });
        setMessage('Đã gắn vào đội. Bạn có thể giao vai trò đội trưởng ở bước tiếp theo.');
      } else {
        const latest = await api<Team>('response', `/teams/${team.id}`);
        await api('response', `/teams/${team.id}/leader`, { method: 'POST', idempotencyKey: pending.current.key,
          body: { user_id: account.id, expected_version: latest.version } });
        setAssigned({ team: latest, role: 'LEADER' });
        setMessage('Đã giao vai trò đội trưởng.');
      }
      pending.current = null;
    } catch (cause) {
      setError(cause instanceof ApiError && cause.code === 'VERSION_CONFLICT'
        ? 'Thông tin đội đã thay đổi. Hãy tải lại rồi thử tiếp.'
        : cause instanceof Error ? cause.message : 'Chưa hoàn tất thao tác với đội.');
      if (cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') pending.current = null;
    } finally { setBusy(false); }
  }

  return <section className="account-team-assignment" aria-label="Vai trò trong đội cứu hộ">
    <div className="account-team-heading"><h3>Vai trò trong đội cứu hộ</h3><button type="button" className="button secondary" onClick={() => setRevision((value) => value + 1)}>Cập nhật</button></div>
    <p>Đội trưởng là vai trò của một đội, không phải quyền cấp trong danh sách vai trò tài khoản. Chọn đội rồi hoàn thành các bước bên dưới.</p>
    {loading && <p role="status">Đang tải đội của tài khoản…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {ready && account.status !== 'ACTIVE' && <p className="notice warning">Hãy kích hoạt tài khoản trước khi giao vai trò trong đội.</p>}
    {ready && account.status === 'ACTIVE' && !choices.length && !assigned &&
      <p className="notice warning">Chưa có đội qua ứng dụng phù hợp với quyền Tình nguyện viên của tài khoản. Hãy cấp quyền Tình nguyện viên cho tổ chức của đội, hoặc tạo đội qua ứng dụng.</p>}
    {ready && account.status === 'ACTIVE' && !assigned && choices.length > 0 &&
      <label className="account-team-select">Đội muốn tham gia
        <select value={selectedTeamId} onChange={(event) => { setSelectedTeamId(event.target.value); setError(''); setMessage(''); pending.current = null; }}>
          <option value="">Chọn đội cứu hộ</option>{choices.map((team) => <option key={team.id} value={team.id}>{team.name} · {organizationName(team.organization_id)}</option>)}
        </select></label>}
    {ready && account.status === 'ACTIVE' && selected && <div className="account-team-steps">
      <div className="account-team-step"><span className="account-team-step-number">1</span><div><strong>Thuộc tổ chức {organizationName(selected.organization_id)}</strong>
        <p>{hasOrganization ? 'Đã là thành viên tổ chức.' : 'Chưa là thành viên tổ chức của đội. Quyền Tình nguyện viên không tự thêm tư cách thành viên tổ chức.'}</p></div>
        {!hasOrganization && <button type="button" className="button secondary" disabled={busy} onClick={() => void run('organization', selected)}>Thêm vào tổ chức</button>}</div>
      <div className="account-team-step"><span className="account-team-step-number">2</span><div><strong>Thành viên {selected.name}</strong>
        <p>{assigned ? 'Đã là thành viên đội.' : 'Gắn tài khoản vào đội sau khi đã thuộc tổ chức.'}</p></div>
        {!assigned && hasOrganization && <button type="button" className="button secondary" disabled={busy} onClick={() => void run('add', selected)}>Gắn vào đội</button>}</div>
      <div className="account-team-step"><span className="account-team-step-number">3</span><div><strong>Đội trưởng</strong>
        <p>{assigned?.role === 'LEADER' ? 'Đang là đội trưởng.' : 'Chỉ giao được khi tài khoản đang hoạt động, có quyền Tình nguyện viên và đã thuộc đội, tổ chức.'}</p></div>
        {assigned && assigned.role !== 'LEADER' && selected.status === 'ACTIVE' && hasOrganization && volunteerIn(selected.organization_id) &&
          <button type="button" className="button" disabled={busy} onClick={() => void run('leader', selected)}>Giao vai trò đội trưởng</button>}</div>
    </div>}
    {message && <p className="notice success" role="status">{message}</p>}
  </section>;
}
