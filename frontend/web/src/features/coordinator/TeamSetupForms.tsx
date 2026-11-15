import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, newCommandKey } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';

export type Skill = { code: string; display_name: string };
export type SelectOption = { value: string; label: string };

function SkillChoices({ skills, selected, onChange }: { skills: Skill[]; selected: string[]; onChange: (codes: string[]) => void }) {
  return <fieldset className="team-skill-choices"><legend className="sr-only">Chọn kỹ năng cho đội</legend>
    {skills.length ? skills.map((skill) => <label className={`team-skill-option${selected.includes(skill.code) ? ' is-selected' : ''}`} key={skill.code}>
      <input type="checkbox" checked={selected.includes(skill.code)} onChange={(event) => onChange(event.target.checked
        ? [...selected, skill.code] : selected.filter((code) => code !== skill.code))} /><span>{skill.display_name}</span>
    </label>) : <p>Chưa có kỹ năng nào trong danh mục.</p>}
  </fieldset>;
}

export function TeamSkillsForm({ teamId, version, current, skills, onSuccess }: {
  teamId: string; version: number; current: string[]; skills: Skill[]; onSuccess: () => void;
}) {
  const [selected, setSelected] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<{ key: string; codes: string[] } | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    if (!pending.current) pending.current = { key: newCommandKey(), codes: [...selected].sort() };
    try {
      await api('response', `/teams/${teamId}`, { method: 'PATCH', idempotencyKey: pending.current.key,
        body: { expected_version: version, skill_codes: pending.current.codes } });
      pending.current = null;
      onSuccess();
    } catch (cause) {
      setError(cause instanceof ApiError && cause.code === 'VERSION_CONFLICT'
        ? 'Đội đã thay đổi. Hãy cập nhật danh sách trước khi lưu kỹ năng.'
        : cause instanceof Error ? cause.message : 'Chưa lưu được kỹ năng.');
      if (cause instanceof ApiError && cause.code === 'VERSION_CONFLICT') pending.current = null;
    } finally { setBusy(false); }
  }
  return <form className="team-skills-panel" onSubmit={submit}>
    <div className="team-skills-heading"><div><h3>Kỹ năng của đội</h3><p>Chọn kỹ năng đội hiện có; bỏ chọn để gỡ kỹ năng.</p></div>
      <span className="chip">{selected.length} kỹ năng</span></div>
    <SkillChoices skills={skills} selected={selected} onChange={(codes) => {
      setSelected(codes); setError(''); pending.current = null;
    }} />
    {error && <p className="notice error" role="alert">{error}</p>}
    <button type="submit" className="button team-skills-save" disabled={busy || !skills.length || selected.slice().sort().join(',') === current.slice().sort().join(',')}>
      {busy ? 'Đang lưu…' : 'Lưu kỹ năng'}
    </button>
  </form>;
}

type UserDetail = { grants?: { role_code: string; scope_type: string; revoked_at: string | null }[] };

/** Build the selector from active volunteer grants and current team memberships. */
function useLeaderCandidates() {
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    setOptions([]);
    void (async () => {
      try {
        const [users, teams] = await Promise.all([
          fetchAll<{ id: string; username: string; display_name: string }>('identity', '/users?status=ACTIVE'),
          fetchAll<{ id: string }>('response', '/teams'),
        ]);
        const memberPages = await Promise.all(teams.map((team) =>
          fetchAll<{ user_id: string }>('response', `/teams/${team.id}/members`)));
        const assignedIds = new Set(memberPages.flat().map((member) => member.user_id));
        const available = users.filter((user) => !assignedIds.has(user.id));
        const eligible: SelectOption[] = [];
        for (let index = 0; index < available.length; index += 8) {
          const batch = available.slice(index, index + 8);
          const details = await Promise.all(batch.map((user) => api<UserDetail>('identity', `/users/${user.id}`)));
          if (!live) return;
          batch.forEach((user, offset) => {
            if (details[offset]?.grants?.some((grant) => !grant.revoked_at && grant.role_code === 'VOLUNTEER' && grant.scope_type === 'SYSTEM'))
              eligible.push({ value: user.id, label: `${user.display_name} · ${user.username}` });
          });
        }
        if (live) setOptions(eligible.sort((a, b) => a.label.localeCompare(b.label, 'vi')));
      } catch {
        if (live) setError('Không tải được danh sách đội trưởng đủ điều kiện.');
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [revision]);
  return { options, loading, error, reload: () => setRevision((value) => value + 1) };
}

export function TeamCreateForm({ skills, onSuccess }: {
  skills: Skill[];
  onSuccess: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [teamKind, setTeamKind] = useState('VOLUNTEER');
  const [reportingMode, setReportingMode] = useState('APP');
  const [leaderId, setLeaderId] = useState('');
  const leaders = useLeaderCandidates();
  const [contactNote, setContactNote] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ key: string; body: Record<string, unknown> } | null>(null);
  const changed = () => { pending.current = null; setError(''); setFieldErrors({}); };
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setFieldErrors({});
    if (reportingMode === 'APP' && !leaderId) { setError('Hãy chọn tài khoản đội trưởng.'); return; }
    if (reportingMode === 'COORDINATOR' && !contactNote.trim()) { setError('Hãy nhập đầu mối liên hệ của đội.'); return; }
    if (!pending.current) pending.current = { key: newCommandKey(), body: {
      name: name.trim().normalize('NFC'),
      team_kind: teamKind, reporting_mode: reportingMode, skill_codes: [...selectedSkills].sort(),
      ...(reportingMode === 'APP' ? { leader_user_id: leaderId } : { external_contact_note: contactNote.trim().normalize('NFC') }),
    } };
    setBusy(true);
    try {
      const team = await api<{ id: string }>('response', '/teams', { method: 'POST', idempotencyKey: pending.current.key, body: pending.current.body });
      pending.current = null; onSuccess(team.id);
    } catch (cause) {
      if (cause instanceof ApiError) setFieldErrors(cause.fieldErrors);
      setError(cause instanceof Error ? cause.message : 'Chưa tạo được đội cứu hộ.');
    } finally { setBusy(false); }
  }
  const fieldError = (name: string) => fieldErrors[name]?.join(' ');
  const hasInvalidFields = !name.trim() || name.length > 200
    || (reportingMode === 'APP'
      ? !leaderId
      : !contactNote.trim() || contactNote.length > 1000)
    || Object.keys(fieldErrors).length > 0;
  return <form className="form-stack command-form" onSubmit={submit}>
    <h3>Tạo đội cứu hộ</h3>
    <label>Tên đội *<input required maxLength={200} value={name} onChange={(e) => { setName(e.target.value); changed(); }} />{fieldError('name') && <small className="field-error">{fieldError('name')}</small>}</label>
    <label>Loại đội *<select value={teamKind} onChange={(e) => { setTeamKind(e.target.value); changed(); }}><option value="VOLUNTEER">Tình nguyện</option>
      <option value="MILITARY">Lực lượng vũ trang</option><option value="GOVERNMENT">Cơ quan nhà nước</option><option value="OTHER">Khác</option></select></label>
    <label>Chế độ báo cáo *<select value={reportingMode} onChange={(e) => { setReportingMode(e.target.value); changed(); }}><option value="APP">Qua ứng dụng</option>
      <option value="COORDINATOR">Điều phối viên ghi nhận</option></select></label>
    {reportingMode === 'APP' ? <label>Đội trưởng *
      <select required value={leaderId} disabled={leaders.loading || Boolean(leaders.error)} onChange={(event) => { setLeaderId(event.target.value); changed(); }}>
        <option value="">{leaders.loading ? 'Đang tải tình nguyện viên…' : 'Chọn tình nguyện viên'}</option>
        {leaders.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {leaders.error && <span className="notice error" role="alert">{leaders.error} <button type="button" className="button secondary" onClick={leaders.reload}>Tải lại</button></span>}
      {!leaders.loading && !leaders.error && leaders.options.length === 0 && <small>Chưa có tình nguyện viên đủ điều kiện và chưa thuộc đội.</small>}
      {fieldError('leader_user_id') && <small className="field-error">{fieldError('leader_user_id')}</small>}
    </label>
      : <label>Đầu mối liên hệ *<textarea required maxLength={1000} value={contactNote} onChange={(e) => { setContactNote(e.target.value); changed(); }} />{fieldError('external_contact_note') && <small className="field-error">{fieldError('external_contact_note')}</small>}</label>}
    <div className="team-create-skills"><h4>Kỹ năng của đội</h4>
      <SkillChoices skills={skills} selected={selectedSkills} onChange={(codes) => { setSelectedSkills(codes); changed(); }} />
    </div>
    {fieldError('skill_codes') && <p className="field-error">{fieldError('skill_codes')}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <button type="submit" className="button" disabled={busy || hasInvalidFields}>{busy ? 'Đang tạo…' : 'Tạo đội cứu hộ'}</button>
  </form>;
}
