import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey } from '../../api/client';
import { useCursorNav, LIST_PAGE_SIZE } from '../../api/useCursorNav';
import { ListNav } from '../../components/ui/Pager';
import { confirmAction } from '../../components/confirmAction';
import { DetailSurface } from '../../components/DetailSurface';
import './team-members.css';

type Member = { user_id: string; display_name: string; member_role: 'LEADER' | 'MEMBER' };
type MemberPage = { items: Member[]; can_manage_members: boolean; cursor?: string; more: boolean };
type Candidate = { user_id: string; username: string; display_name: string };
type CandidatePage = { items: Candidate[]; cursor?: string; more: boolean };

export function TeamMembers({ teamId, onManageChange, addOpen, onOpenAdd, onCloseAdd, readOnly = false }: { readOnly?: boolean; teamId: string; onManageChange: (allowed: boolean) => void; addOpen: boolean; onOpenAdd: () => void; onCloseAdd: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [memberCursor, setMemberCursor, prevMembers, memberPage] = useCursorNav<string>('');
  const [memberNext, setMemberNext] = useState('');
  const [query, setQuery] = useState('vol');
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [candidateNext, setCandidateNext] = useState('');
  const [candidateCursor, setCandidateCursor, prevCandidates, candidatePage] = useCursorNav<string>('');
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
        setCanManage(!readOnly && page.can_manage_members);
        onManageChange(!readOnly && page.can_manage_members);
        setMemberNext(page.cursor || '');
      })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải thành viên đội.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [teamId, memberCursor, revision, onManageChange, readOnly]);

  useEffect(() => {
    setMembers([]);
    setMemberCursor('');
    setMemberNext('');
    setCanManage(false);
    setQuery('vol');
    setSearched(false);
    setCandidates([]);
    setSelectedCandidate(null);
    setCandidateNext('');
    setCandidateCursor('');
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
      setCandidates(page.items);
      setSelectedCandidate(null);
      setCandidateNext(page.cursor || '');
      setSearched(true);
    } catch (cause) {
      if (generation === searchGeneration.current)
        setSearchError(cause instanceof Error ? cause.message : 'Không thể tìm người tham gia.');
    } finally {
      if (generation === searchGeneration.current) setSearching(false);
    }
  }

  async function search(event?: FormEvent) {
    event?.preventDefault();
    if (queryInvalid) return;
    if (searchDebounce.current !== null) {
      window.clearTimeout(searchDebounce.current);
      searchDebounce.current = null;
    }
    if (candidateCursor) { setCandidateCursor(''); return; }
    const generation = ++searchGeneration.current;
    await loadCandidates(searchTerm, '', generation);
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
        setSelectedCandidate(null);
        setCandidateNext('');
        setSearched(false);
        setSearchError('');
      }
      return () => { searchGeneration.current += 1; };
    }

    setSearching(true);
    setSearchError('');
    setCandidates([]);
    setSelectedCandidate(null);
    const timer = window.setTimeout(() => {
      searchDebounce.current = null;
      void loadCandidates(searchTerm, candidateCursor, generation);
    }, 300);
    searchDebounce.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (searchDebounce.current === timer) searchDebounce.current = null;
      searchGeneration.current += 1;
    };
  }, [teamId, searchTerm, addOpen, candidateCursor]);

  function closeAddDialog(force = false) {
    if (busyId && !force) return;
    if (searchDebounce.current !== null) {
      window.clearTimeout(searchDebounce.current);
      searchDebounce.current = null;
    }
    searchGeneration.current += 1;
    setQuery('vol');
    setSearched(false);
    setCandidates([]);
    setSelectedCandidate(null);
    setCandidateNext('');
    setCandidateCursor('');
    setSearchError('');
    setSearching(false);
    onCloseAdd();
  }

  async function add(candidate: Candidate) {
    setBusyId(candidate.user_id);
    setSearchError('');
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
      closeAddDialog(true);
    } catch (cause) {
      setSearchError(cause instanceof Error ? cause.message : 'Chưa thể thêm thành viên.');
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
      <div className="team-members-heading-actions">
        {members.length > 0 && <span className="chip">{members.length}{memberNext ? '+' : ''} người</span>}
        {canManage && <button type="button" className="button team-member-open-add" onClick={onOpenAdd}>Thêm thành viên</button>}
      </div>
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
    {addOpen && <DetailSurface modal open canClose={() => !busyId} onClose={closeAddDialog} label="Thêm thành viên vào đội" heading="Thêm thành viên" className="team-member-dialog"><div className="team-member-add">
      {!loading && !canManage && <p className="notice error" role="alert">Bạn không có quyền thêm thành viên vào đội này.</p>}
      {canManage && <>
      <p className="muted team-member-add__intro">Tìm theo tên hoặc tên đăng nhập của người cần thêm. Kết quả chỉ gồm tài khoản chưa thuộc đội; người được thêm cần có vai trò tình nguyện viên.</p>
      <form className="team-member-search" noValidate onSubmit={(event) => void search(event)}>
        <label htmlFor="team-member-query">Tìm người tham gia</label>
        <div className="team-member-search-row">
          <input id="team-member-query" autoFocus value={query} disabled={Boolean(busyId)} maxLength={65} placeholder="Nhập ít nhất 2 ký tự để tìm" aria-invalid={Boolean(query.trim() && queryInvalid)}
            onChange={(event) => {
              if (searchDebounce.current !== null) {
                window.clearTimeout(searchDebounce.current);
                searchDebounce.current = null;
              }
              searchGeneration.current += 1;
              setQuery(event.target.value); setCandidateCursor(''); setCandidates([]); setSelectedCandidate(null); setSearched(false); setCandidateNext(''); setSearchError(''); pendingAdd.current = null;
              setSearching(false);
            }} />
        </div>
      </form>
      {searchTerm.length >= 2 && searchTerm.length <= 64 && <div className="team-member-search-results" aria-busy={searching}>
      {searchError && <p className="notice error" role="alert">{searchError}</p>}
      {searching && <p className="team-member-search-status" role="status">Đang tìm người phù hợp…</p>}
      {searched && !searching && !searchError && candidates.length === 0 && <p className="empty" role="status">{candidateNext ? 'Trang này không có người có thể thêm. Chọn “Trang sau” để xem tiếp.' : 'Không tìm thấy tài khoản phù hợp chưa tham gia đội. Thử tên hoặc tên đăng nhập khác.'}</p>}
      {candidates.length > 0 && <div className="team-member-results-heading"><strong>Kết quả phù hợp</strong><span>{candidates.length}{candidateNext ? '+' : ''} người</span></div>}
      <div className="team-member-candidates">
        {candidates.map((candidate) => <button type="button" className={`team-member-row team-member-candidate-choice${selectedCandidate?.user_id === candidate.user_id ? ' is-selected' : ''}`}
          key={candidate.user_id} aria-pressed={selectedCandidate?.user_id === candidate.user_id} disabled={Boolean(busyId)}
          onClick={() => setSelectedCandidate((current) => current?.user_id === candidate.user_id ? null : candidate)}>
          <span className="team-member-avatar" aria-hidden="true">{candidate.display_name.trim().charAt(0).toLocaleUpperCase('vi')}</span>
          <span className="team-member-identity"><strong>{candidate.display_name}</strong><span>@{candidate.username}</span></span>
          <span className="team-member-candidate-check" aria-hidden="true">{selectedCandidate?.user_id === candidate.user_id ? '✓' : ''}</span>
        </button>)}
      </div>
      <ListNav page={candidatePage} hasNext={Boolean(candidateNext)} loading={searching || Boolean(busyId)} onPrev={prevCandidates} onNext={() => candidateNext && setCandidateCursor(candidateNext)} count={candidates.length} noun="kết quả" />
      {selectedCandidate && <button type="button" className="button team-member-confirm-add" disabled={Boolean(busyId)}
        onClick={() => void add(selectedCandidate)}>{busyId ? 'Đang thêm…' : `Thêm ${selectedCandidate.display_name} vào đội`}</button>}
      </div>}
      </>}
    </div></DetailSurface>}
  </section>;
}
