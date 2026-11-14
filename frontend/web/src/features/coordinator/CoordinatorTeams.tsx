import { useEffect, useState } from 'react';
import { fetchAll } from '../../api/fetchAll';
import { useCursorPages } from '../../api/useCursorPages';
import { Pager } from '../../components/ui/Pager';
import { CommandForm } from '../../components/CommandForm';
import { label } from '../../i18n/labels';
import type { Me } from '../../auth/session';
import { TeamMembers } from '../volunteer/TeamMembers';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { TeamCreateForm, TeamSkillsForm, type Skill } from './TeamSetupForms';
import { DetailSurface } from '../../components/DetailSurface';
import './teams-page.css';

type Team = { id: string; name: string; organization_id: string; operating_region_code: string;
  nationwide_coverage: boolean; availability: string; status: string; version: number; skills: string[]; position: { age_s: number } | null };
type Region = { code: string; name: string; status: string };
type Member = { user_id: string; display_name: string; member_role: string };

function positionAge(ageSeconds: number): string {
  const minutes = Math.max(0, Math.round(ageSeconds / 60));
  const age = minutes < 60 ? `${minutes} phút` : minutes < 1440 ? `${Math.round(minutes / 60)} giờ` : `${Math.round(minutes / 1440)} ngày`;
  return `${minutes > 30 ? 'Vị trí cũ' : 'Vị trí mới cập nhật'} · ${age} trước`;
}

export function CoordinatorTeams({ user }: { user: Me }) {
  const [regions, setRegions] = useState<Region[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [organizations, setOrganizations] = useState<{ value: string; label: string }[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const teamPages = useCursorPages<Team>('response', '/teams', 10);
  const teams = teamPages.items;
  const [members, setMembers] = useState<Member[]>([]);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [lookupError, setLookupError] = useState('');
  const loading = teamPages.loading;
  const error = teamPages.error || lookupError;
  const selected = teams.find((team) => team.id === selectedId);
  const visibleTeams = teams;
  const isAdmin = user.grants.some((grant) => grant.role_code === 'ADMIN');
  const canManageNationwide = Boolean(selected && user.grants.some((grant) =>
    (grant.role_code === 'ADMIN' && grant.scope_type === 'SYSTEM') ||
    (grant.role_code === 'COORDINATOR' && grant.scope_type === 'ORGANIZATION' && grant.organization_id === selected.organization_id)));

  useEffect(() => {
    let live = true;
    setLookupError('');
    void Promise.all([fetchAll<Region>('identity', '/regions'), fetchAll<Skill>('response', '/skills')])
      .then(([regionRows, skillRows]) => { if (live) { setRegions(regionRows); setSkills(skillRows); } })
      .catch((cause) => { if (live) setLookupError(cause instanceof Error ? cause.message : 'Không tải được danh mục khu vực và kỹ năng.'); });
    return () => { live = false; };
  }, [revision]);

  useEffect(() => {
    if (!isAdmin || !showCreate) return;
    let live = true;
    void fetchAll<{ id: string; name: string; status: string }>('identity', '/organizations')
      .then((orgRows) => { if (live) setOrganizations(orgRows.filter((row) => row.status === 'ACTIVE').map((row) => ({ value: row.id, label: row.name }))); })
      .catch(() => { if (live) setOrganizations([]); });
    return () => { live = false; };
  }, [isAdmin, showCreate]);

  useEffect(() => {
    if (!selectedId) return;
    let live = true;
    void fetchAll<Member>('response', `/teams/${selectedId}/members`)
      .then((rows) => { if (live) setMembers(rows); })
      .catch(() => { if (live) setMembers([]); });
    return () => { live = false; };
  }, [selectedId, revision]);

  const refresh = () => { setRevision((current) => current + 1); teamPages.reload(); };
  const closeDetail = () => { setSelectedId(''); setAddMemberOpen(false); };
  return <div className="admin-team-management">
    <Card id="coordinator-team-list" className="coordinator-team-list-card">
      <div className="section-header"><h2>Quản lý đội cứu hộ</h2><div className="team-header-actions">
        {isAdmin && <Button type="button" onClick={() => setShowCreate((value) => !value)}>{showCreate ? 'Đóng biểu mẫu' : 'Tạo đội'}</Button>}
        <Button type="button" variant="secondary" onClick={refresh}>Cập nhật</Button></div></div>
      <p>Phạm vi hoạt động quyết định SOS nào có thể giao; GPS cho biết đội đang ở đâu. Đội toàn quốc vẫn phải thuộc cùng tổ chức với SOS.</p>
      {isAdmin && showCreate && <TeamCreateForm organizations={organizations} regions={regions.filter((row) => row.status === 'ACTIVE').map((row) => ({ value: row.code, label: row.name }))}
        skills={skills} onSuccess={(id) => { setShowCreate(false); setSelectedId(id); refresh(); }} />}
      {loading && <Skeleton label="Đang tải đội cứu hộ…" />}
      {error && <div className="notice error" role="alert">{error} <Button type="button" variant="secondary" onClick={refresh}>Thử lại</Button></div>}
      {!loading && teams.length > 0 && <><div className="team-table-scroll"><table className="team-table">
        <thead><tr><th scope="col">Tên đội</th><th scope="col">Phạm vi</th><th scope="col">Kỹ năng</th><th scope="col">Tình trạng · vị trí</th></tr></thead>
        <tbody>{visibleTeams.map((team) => <tr key={team.id} tabIndex={0} className="team-table-row"
          aria-label={`Xem chi tiết ${team.name}`} onClick={() => setSelectedId(team.id)}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(team.id); } }}>
          <th scope="row">{team.name}</th>
          <td>{team.nationwide_coverage ? 'Toàn quốc' : regions.find((region) => region.code === team.operating_region_code)?.name || team.operating_region_code}</td>
          <td>{team.skills.length ? team.skills.map((code) => skills.find((item) => item.code === code)?.display_name || label(code)).join(', ') : 'Chưa gắn kỹ năng'}</td>
          <td><span className={`team-status-dot${team.status !== 'ACTIVE' || team.availability !== 'AVAILABLE' ? ' is-inactive' : ''}`} />{team.status === 'ACTIVE' ? label(team.availability) : label(team.status)}
            <small>{team.position ? positionAge(team.position.age_s) : 'Chưa có vị trí'}</small></td>
        </tr>)}</tbody>
      </table></div><Pager page={teamPages.page} hasNext={teamPages.hasNext} loading={teamPages.loading} onPrev={teamPages.prev} onNext={teamPages.next} count={teams.length} noun="đội" /></>}
      {!loading && !teams.length && !error && teamPages.page === 0 && <EmptyState title="Chưa có đội cứu hộ" description="Hiện chưa có đội trong phạm vi quản lý của bạn." />}
    </Card>
    {selected && <DetailSurface key={selected.id} modal open onClose={closeDetail} label={`Chi tiết đội ${selected.name}`} heading={selected.name} className="team-detail-dialog">
      <p>Khu vực gốc: <strong>{regions.find((region) => region.code === selected.operating_region_code)?.name || selected.operating_region_code}</strong>. Phạm vi: <strong>{selected.nationwide_coverage ? 'Toàn quốc' : 'Theo khu vực gốc'}</strong>. Đội phải không có nhiệm vụ đang hoạt động khi đổi phạm vi.</p>
      <TeamSkillsForm key={`skills-${selected.id}-${selected.version}`} teamId={selected.id} version={selected.version} current={selected.skills} skills={skills} onSuccess={refresh} />
      <div className="admin-team-actions">
        <div>
          <CommandForm key={`${selected.id}-${selected.version}`} spec={{
            title: 'Chuyển khu vực hoạt động', service: 'response', method: 'PATCH', path: `/teams/${selected.id}`,
            version: selected.version, warning: `Chuyển phạm vi hoạt động của ${selected.name}? Phạm vi mới quyết định SOS có thể giao.`,
            fields: [{ name: 'operating_region_code', label: 'Khu vực mới', type: 'select', required: true,
              options: regions.filter((region) => region.status === 'ACTIVE').map((region) => ({ value: region.code, label: region.name })) }],
          }} onSuccess={refresh} onStale={refresh} />
        </div>
        {canManageNationwide && <div>
          <CommandForm key={`coverage-${selected.id}-${selected.version}`} spec={{
            title: 'Phạm vi phụ trách', service: 'response', method: 'PATCH', path: `/teams/${selected.id}`,
            version: selected.version, warning: `Đổi phạm vi phụ trách của ${selected.name}? Đội chỉ được đề xuất khi vị trí đủ gần và còn mới.`,
            build: (values) => ({ nationwide_coverage: values.nationwide_coverage === 'true' }),
            fields: [{ name: 'nationwide_coverage', label: 'Phạm vi', type: 'select', required: true,
              options: [{ value: 'false', label: 'Theo khu vực gốc' }, { value: 'true', label: 'Toàn quốc' }] }],
          }} onSuccess={refresh} onStale={refresh} />
        </div>}
        {!isAdmin && <div>
          <h3>Đội trưởng</h3>
          <p>Người được chọn phải là thành viên đang hoạt động của đội, có quyền Tình nguyện viên trong tổ chức của đội.</p>
          <CommandForm key={`leader-${selected.id}-${selected.version}-${members.length}`} spec={{
            title: 'Giao vai trò đội trưởng', service: 'response', path: `/teams/${selected.id}/leader`, version: selected.version,
            warning: `Chuyển vai trò đội trưởng của ${selected.name} cho thành viên được chọn?`,
            fields: [{ name: 'user_id', label: 'Thành viên', type: 'select', required: true,
              options: members.map((member) => ({ value: member.user_id, label: `${member.display_name}${member.member_role === 'LEADER' ? ' · Đội trưởng hiện tại' : ''}` })) }],
          }} onSuccess={refresh} onStale={refresh} />
        </div>}
      </div>
      <details className="team-member-section"><summary>Thành viên đội ({members.length})</summary>
        <Button type="button" variant="secondary" onClick={() => setAddMemberOpen(true)}>Thêm thành viên vào đội</Button>
        <TeamMembers key={`${selected.id}-${revision}`} teamId={selected.id} onManageChange={() => {}} addOpen={addMemberOpen} onCloseAdd={() => { setAddMemberOpen(false); refresh(); }} />
      </details>
    </DetailSurface>}
  </div>;
}
