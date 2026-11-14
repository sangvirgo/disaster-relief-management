import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey } from '../../api/client';
import { useCursorNav, LIST_PAGE_SIZE } from '../../api/useCursorNav';
import { ListNav, LoadMore } from '../../components/ui/Pager';
import { confirmAction } from '../../components/confirmAction';
import { DetailSurface } from '../../components/DetailSurface';
import './team-members.css';

type Member = { user_id: string; display_name: string; member_role: 'LEADER' | 'MEMBER' };
type MemberPage = { items: Member[]; can_manage_members: boolean; cursor?: string; more: boolean };
type Candidate = { user_id: string; username: string; display_name: string };
type CandidatePage = { items: Candidate[]; cursor?: string; more: boolean };

export function TeamMembers({ teamId, onManageChange, addOpen, onCloseAdd }: { teamId: string; onManageChange: (allowed: boolean) => void; addOpen: boolean; onCloseAdd: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [memberCursor, setMemberCursor, prevMembers, memberPage] = useCursorNav<string>('');
  const [memberNext, setMemberNext] = useState('');
  const [query, setQuery] = useState('');
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
  const searchDebounce = useRef<number | null>(null);
  const searchTerm = query.trim();
  const queryInvalid = searchTerm.length < 2 || searchTerm.length > 64;

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api<MemberPage>('response', `/teams/${teamId}/members?limit=${LIST_PAGE_SIZE}${memberCursor ? `&cursor=${encodeURIComponent(memberCursor)}` : ''}`)
      .then((page) => {
        if (!live) return;
        setMembers(page.items);
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
    setSearched(false);
    setCandidates([]);
    setCandidateNext('');
    setMessage('');
    setSearchError('');
    pendingAdd.current = null;
  }, [teamId]);

  async function loadCandidates(term: string, nextCursor: string, generation: number) {
    setSearching(true);
    setSearchError('');
    try {
      const params = new URLSearchParams({ query: term, limit: String(LIST_PAGE_SIZE) });
      if (nextCursor) params.set('cursor', nextCursor);
      const page = await api<CandidatePage>('response', `/teams/${teamId}/member-candidates?${params}`);
      if (generation !== searchGeneration.current) return;
      setCandidates((current) => nextCursor ? [...current, ...page.items.filter((item) => !current.some((existing) => existing.user_id === item.user_id))] : page.items);
      setCandidateNext(page.cursor || '');
      setSearched(true);
    } catch (cause) {
      if (generation === searchGeneration.current)
        setSearchError(cause instanceof Error ? cause.message : 'Không thể tìm người tham gia.');
    } finally {
      if (generation === searchGeneration.current) setSearching(false);
    }
  }

  async function search(event?: FormEvent, nextCursor = '') {
    event?.preventDefault();
    if (queryInvalid) return;
    if (searchDebounce.current !== null) {
      window.clearTimeout(searchDebounce.current);
      searchDebounce.current = null;
    }
    const generation = ++searchGeneration.current;
    await loadCandidates(searchTerm, nextCursor, generation);
  }

  useEffect(() => {
    if (searchDebounce.current !== null) {
      window.clearTimeout(searchDebounce.current);
      searchDebounce.current = null;
    }
    const generation = ++searchGeneration.current;
    if (!addOpen || searchTerm.length < 2 || searchTerm.length > 64) {
      setSearching(false);
      if (searchTerm.length < 2 || searchTerm.length > 64) {
        setCandidates([]);
        setCandidateNext('');
        setSearched(false);
        setSearchError('');
      }
      return () => { searchGeneration.current += 1; };
    }

    setSearching(true);
    setSearchError('');
    const timer = window.setTimeout(() => {
      searchDebounce.current = null;
      void loadCandidates(searchTerm, '', generation);
    }, 300);
    searchDebounce.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (searchDebounce.current === timer) searchDebounce.current = null;
      searchGeneration.current += 1;
    };
  }, [teamId, searchTerm, addOpen]);

  function closeAddDialog() {
    if (searchDebounce.current !== null) {
      window.clearTimeout(searchDebounce.current);
      searchDebounce.current = null;
    }
    searchGeneration.current += 1;
    setQuery('');
    setSearched(false);
    setCandidates([]);
    setCandidateNext('');
    setSearchError('');
    setSearching(false);
    onCloseAdd();
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
    <ListNav page={memberPage} hasNext={Boolean(memberNext)} loading={loading} onPrev={prevMembers} onNext={() => memberNext && setMemberCursor(memberNext)} count={members.length} noun="thành viên" />
    {message && <p className="notice success" role="status">{message}</p>}
    {addOpen && <DetailSurface modal open onClose={closeAddDialog} label="Thêm thành viên vào đội" heading="Thêm thành viên" className="team-member-dialog"><div className="team-member-add">
      {!loading && !canManage && <p className="notice error" role="alert">Bạn không có quyền thêm thành viên vào đội này.</p>}
      {canManage && <>
      <p className="muted team-member-add__intro">Tìm theo tên hoặc tài khoản. Tài khoản phải đang hoạt động và chưa thuộc đội khác. Để làm đội trưởng, người đó còn cần quyền Tình nguyện viên trong tổ chức của đội.</p>
      <form className="team-member-search" noValidate onSubmit={(event) => void search(event)}>
        <label htmlFor="team-member-query">Tìm người tham gia</label>
        <div className="team-member-search-row">
          <input id="team-member-query" autoFocus value={query} maxLength={65} placeholder="Nhập ít nhất 2 ký tự" aria-invalid={Boolean(query.trim() && queryInvalid)}
            onChange={(event) => {
              if (searchDebounce.current !== null) {
                window.clearTimeout(searchDebounce.current);
                searchDebounce.current = null;
              }
              searchGeneration.current += 1;
              setQuery(event.target.value); setCandidates([]); setSearched(false); setCandidateNext(''); setSearchError(''); pendingAdd.current = null;
              setSearching(false);
            }} />
          <button type="submit" className="button" disabled={searching || queryInvalid}>
            <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75">
              <circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" />
            </svg>
            {searching ? 'Đang tìm…' : 'Tìm thành viên'}
          </button>
        </div>
      </form>
      {searchTerm.length >= 2 && searchTerm.length <= 64 && <div className="team-member-search-results" aria-busy={searching}>
      {searchError && <p className="notice error" role="alert">{searchError}</p>}
      {searching && <p className="team-member-search-status" role="status">Đang tìm người phù hợp…</p>}
      {searched && !searching && candidates.length === 0 && !candidateNext && <p className="empty">Không tìm thấy người phù hợp chưa tham gia đội.</p>}
      {candidates.length > 0 && <div className="team-member-results-heading"><strong>Kết quả phù hợp</strong><span>{candidates.length}{candidateNext ? '+' : ''} người</span></div>}
      <div className="team-member-candidates">
        {candidates.map((candidate) => <article className="team-member-row" key={candidate.user_id}>
          <div className="team-member-avatar" aria-hidden="true">{candidate.display_name.trim().charAt(0).toLocaleUpperCase('vi')}</div>
          <div className="team-member-identity"><strong>{candidate.display_name}</strong><span>@{candidate.username}</span></div>
          <button type="button" className="button team-member-add-button" aria-label={`Thêm ${candidate.display_name} vào đội`} disabled={Boolean(busyId)} onClick={() => void add(candidate)}>{busyId === candidate.user_id ? 'Đang thêm…' : 'Thêm vào đội'}</button>
        </article>)}
      </div>
      {candidates.length > 0 && <LoadMore hasMore={Boolean(candidateNext)} loading={searching} onClick={() => void search(undefined, candidateNext)} shown={candidates.length} noun="kết quả" />}
      </div>}
      </>}
    </div></DetailSurface>}
  </section>;
}
