import { useEffect, useState } from 'react';
import { useLoadMore } from '../../api/useCursorPages';
import { LoadMore } from '../../components/ui/Pager';
import { TeamReadinessForm } from '../volunteer/TeamReadinessForm';

type Team = { id: string; name: string; version: number; readiness_required: boolean };

export function TeamReadinessQueue({ refreshRevision, onChanged }: { refreshRevision: number; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const list = useLoadMore<Team>('response', '/teams?availability=UNAVAILABLE&status=ACTIVE', 10, open);
  const teams = list.items.filter(team => team.readiness_required);
  const loading = list.loading;
  const error = list.error;
  useEffect(() => { if (open) list.reload(); }, [revision, refreshRevision]);
  return <>
    <button type="button" className="button secondary" disabled={loading}
      onClick={() => { setMessage(''); setRevision(value => value + 1); setOpen(true); }}>Cập nhật danh sách đội</button>
    {open && <section className="team-readiness-results" aria-label="Kết quả cập nhật danh sách đội" aria-busy={loading}>
    {message && <p role="status" className="notice">{message}</p>}
    {loading && <p role="status">Đang tải các đội cần xác nhận…</p>}
    {error && <p role="alert" className="notice error">{error}</p>}
    {!loading && !error && !teams.length && <p role="status">Đã cập nhật. Không có đội đang chờ xác nhận sẵn sàng trong phạm vi của bạn.</p>}
    {!error && teams.length > 0 && <>
    <p>Chỉ ghi nhận sau khi đã nhận được xác nhận từ đội. Danh sách giới hạn theo quyền và phạm vi tài khoản của bạn.</p>
    <fieldset disabled={loading} className="form-stack team-readiness-list" aria-label="Các đội cần xác nhận sẵn sàng">
    {teams.map(team => <details key={`${team.id}-${team.version}`} className="candidate">
      <summary>{team.name}</summary>
      <TeamReadinessForm teamId={team.id} teamName={team.name} version={team.version} recorded
        onSuccess={() => { setMessage(`Đã ghi nhận ${team.name} sẵn sàng trở lại.`); setRevision(value => value + 1); onChanged(); }}
        onStale={() => { setRevision(value => value + 1); onChanged(); }} />
    </details>)}
    </fieldset>
    <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} shown={teams.length} noun="đội" />
    </>}
    </section>}
  </>;
}
