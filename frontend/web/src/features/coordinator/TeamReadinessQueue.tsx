import { useEffect, useState } from 'react';
import { fetchAll } from '../../api/fetchAll';
import { TeamReadinessForm } from '../volunteer/TeamReadinessForm';

type Team = { id: string; name: string; version: number; readiness_required: boolean };

export function TeamReadinessQueue({ refreshRevision, onChanged }: { refreshRevision: number; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setError('');
    fetchAll<Team>('response', '/teams?availability=UNAVAILABLE&status=ACTIVE').then(items => {
      if (live) setTeams(items.filter(team => team.readiness_required));
    }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải đội cần xác nhận sẵn sàng.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [open, revision, refreshRevision]);
  return <>
    <button type="button" className="button secondary" disabled={loading}
      onClick={() => { setLoading(true); setMessage(''); setRevision(value => value + 1); setOpen(true); }}>Cập nhật danh sách đội</button>
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
    </>}
    </section>}
  </>;
}
