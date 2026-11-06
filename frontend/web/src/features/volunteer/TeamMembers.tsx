import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey } from '../../api/client';
import { appendPage } from '../../api/pagination';
import { confirmAction } from '../../components/confirmAction';
import { DetailSurface } from '../../components/DetailSurface';

type Member = { user_id: string; display_name: string; member_role: 'LEADER' | 'MEMBER' };
type MemberPage = { items: Member[]; can_manage_members: boolean; cursor?: string; more: boolean };
type Candidate = { user_id: string; username: string; display_name: string };
type CandidatePage = { items: Candidate[]; cursor?: string; more: boolean };

export function TeamMembers({ teamId, onManageChange, addOpen, onCloseAdd }: { teamId: string; onManageChange: (allowed: boolean) => void; addOpen: boolean; onCloseAdd: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [memberCursor, setMemberCursor] = useState('');
  const [memberNext, setMemberNext] = useState('');
  const [query, setQuery] = useState('');
  const [queryTouched, setQueryTouched] = useState(false);
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateNext, setCandidateNext] = useState('');
  const [busyId, setBusyId] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const pendingAdd = useRef<{ userId: string; key: string } | null>(null);
  const searchGeneration = useRef(0);
  const searchTerm = query.trim();
  const queryError = searchTerm.length < 2 ? 'Nhập ít nhất 2 ký tự để tìm người tham gia.'
    : searchTerm.length > 64 ? 'Từ khóa không được vượt quá 64 ký tự.' : '';

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api<MemberPage>('response', `/teams/${teamId}/members${memberCursor ? `?cursor=${encodeURIComponent(memberCursor)}` : ''}`)
      .then((page) => {
        if (!live) return;
        setMembers((current) => memberCursor ? appendPage(current, page.items, (item) => item.user_id) : page.items);
        setCanManage(page.can_manage_members);
        onManageChange(page.can_manage_members);
        setMemberNext(page.cursor || '');
      })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải thành viên đội.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [teamId, memberCursor, revision, onManageChange]);

  useEffect(() => {
    setMembers([]);
    setMemberCursor('');
    setMemberNext('');
    setCanManage(false);
    setQuery('');
    setQueryTouched(false);
    setSearched(false);
    setCandidates([]);
    setCandidateNext('');
    setMessage('');
    setSearchError('');
    pendingAdd.current = null;
  }, [teamId]);

  async function search(event?: FormEvent, nextCursor = '') {
    event?.preventDefault();
    setQueryTouched(true);
    if (queryError) return;
    setSearching(true);
    setSearchError('');
    const generation = ++searchGeneration.current;
    try {
      const params = new URLSearchParams({ query: searchTerm });
      if (nextCursor) params.set('cursor', nextCursor);
      const page = await api<CandidatePage>('response', `/teams/${teamId}/member-candidates?${params}`);
      if (generation !== searchGeneration.current) return;
      setCandidates((current) => nextCursor ? appendPage(current, page.items, (item) => item.user_id) : page.items);
      setCandidateNext(page.cursor || '');
      setSearched(true);
    } catch (cause) {
      if (generation === searchGeneration.current)
        setSearchError(cause instanceof Error ? cause.message : 'Không thể tìm người tham gia.');
    } finally {
      if (generation === searchGeneration.current) setSearching(false);
    }
  }

  async function add(candidate: Candidate) {
    setBusyId(candidate.user_id);
    setError('');
    setMessage('');
    if (pendingAdd.current?.userId !== candidate.user_id)
      pendingAdd.current = { userId: candidate.user_id, key: newCommandKey() };
    try {
      await api('response', `/teams/${teamId}/members`, {
        method: 'POST', idempotencyKey: pendingAdd.current.key, body: { user_id: candidate.user_id },
      });
      pendingAdd.current = null;
      setCandidates((current) => current.filter((item) => item.user_id !== candidate.user_id));
      setMessage(`Đã thêm ${candidate.display_name} vào đội.`);
      setMemberCursor('');
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa thể thêm thành viên.');
    } finally {
      setBusyId('');
    }
  }

  async function remove(member: Member) {
    if (!(await confirmAction(`Đưa ${member.display_name} ra khỏi đội?`))) return;
    setBusyId(member.user_id);
    setError('');
    setMessage('');
    try {
      await api('response', `/teams/${teamId}/members/${member.user_id}/remove`, {
        method: 'POST', idempotencyKey: newCommandKey(),
      });
      setMessage(`Đã đưa ${member.display_name} ra khỏi đội.`);
      setMemberCursor('');
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa thể đưa thành viên ra khỏi đội.');
    } finally {
      setBusyId('');
    }
  }

  return <section className="team-members" aria-label="Thành viên đội">
    <div className="team-members-heading">
      <div><h3>Thành viên đội</h3><p className="muted">{canManage ? 'Bạn có thể thêm hoặc đưa thành viên ra khỏi đội.' : 'Danh sách người đang tham gia đội.'}</p></div>
      {members.length > 0 && <span className="chip">{members.length}{memberNext ? '+' : ''} người</span>}
    </div>
    {loading && <p role="status">Đang tải thành viên…</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {!loading && !error && members.length === 0 && <p className="empty">Đội chưa có thành viên trong danh sách.</p>}
    <div className="team-member-list">
      {members.map((member) => <article className="team-member-row" key={member.user_id}>
        <div className="team-member-avatar" aria-hidden="true">{member.display_name.trim().charAt(0).toLocaleUpperCase('vi')}</div>
        <div className="team-member-identity"><strong>{member.display_name}</strong><span>{member.member_role === 'LEADER' ? 'Trưởng đội' : 'Thành viên'}</span></div>
        {canManage && member.member_role !== 'LEADER' && <button type="button" className="button secondary team-member-remove" aria-label={`Đưa ${member.display_name} ra khỏi đội`} disabled={Boolean(busyId)} onClick={() => void remove(member)}>Đưa ra khỏi đội</button>}
      </article>)}
    </div>
    {memberNext && <button type="button" className="button secondary" disabled={loading} onClick={() => setMemberCursor(memberNext)}>Xem thêm thành viên</button>}
    {message && <p className="notice success" role="status">{message}</p>}
    {addOpen && <DetailSurface modal open onClose={onCloseAdd} label="Thêm thành viên vào đội" className="team-member-dialog"><div className="team-member-add">
      <h4>Thêm thành viên</h4>
      {!loading && !canManage && <p className="notice error" role="alert">Bạn không có quyền thêm thành viên vào đội này.</p>}
      {canManage && <>
      <p className="muted">Tìm theo tên hoặc tài khoản. Người đó cần có vai trò Tình nguyện viên và chưa thuộc đội khác.</p>
      <form className="team-member-search" noValidate onSubmit={(event) => void search(event)}>
        <label htmlFor="team-member-query">Tìm người tham gia</label>
        <div className="team-member-search-row">
          <input id="team-member-query" value={query} maxLength={65} placeholder="Nhập ít nhất 2 ký tự" aria-invalid={Boolean(queryTouched && queryError)}
            onBlur={() => setQueryTouched(true)} onChange={(event) => {
              searchGeneration.current += 1;
              setQuery(event.target.value); setCandidates([]); setSearched(false); setCandidateNext(''); setSearchError(''); pendingAdd.current = null;
              setSearching(false);
            }} />
          <button className="button" disabled={searching}>{searching ? 'Đang tìm…' : 'Tìm thành viên'}</button>
        </div>
        {queryTouched && queryError && <small className="field-error" role="alert">{queryError}</small>}
      </form>
      {searchError && <p className="notice error" role="alert">{searchError}</p>}
      {searched && !searching && candidates.length === 0 && !candidateNext && <p className="empty">Không tìm thấy người phù hợp chưa tham gia đội.</p>}
      <div className="team-member-candidates">
        {candidates.map((candidate) => <article className="team-member-row" key={candidate.user_id}>
          <div className="team-member-avatar" aria-hidden="true">{candidate.display_name.trim().charAt(0).toLocaleUpperCase('vi')}</div>
          <div className="team-member-identity"><strong>{candidate.display_name}</strong><span>@{candidate.username}</span></div>
          <button type="button" className="button team-member-add-button" aria-label={`Thêm ${candidate.display_name} vào đội`} disabled={Boolean(busyId)} onClick={() => void add(candidate)}>{busyId === candidate.user_id ? 'Đang thêm…' : 'Thêm vào đội'}</button>
        </article>)}
      </div>
      {candidateNext && <button type="button" className="button secondary" disabled={searching} onClick={() => void search(undefined, candidateNext)}>Xem thêm kết quả</button>}
      </>}
    </div></DetailSurface>}
  </section>;
}
