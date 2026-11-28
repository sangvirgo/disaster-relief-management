import { useEffect, useRef, useState } from 'react';
import { api, ApiError, newCommandKey } from '../../api/client';
import { useLoadMore } from '../../api/useCursorPages';
import { LoadMore } from '../../components/ui/Pager';
import { DetailSurface } from '../../components/DetailSurface';

type Team = { id: string; name: string; version: number; readiness_required: boolean };
type Basis = 'PHONE' | 'RADIO' | 'IN_PERSON' | 'OTHER';
const bases: Array<[Basis, string]> = [['PHONE', 'Điện thoại'], ['RADIO', 'Bộ đàm'], ['IN_PERSON', 'Trực tiếp'], ['OTHER', 'Khác']];

/**
 * Teams waiting for a coordinator to record that they are ready again. One row per team; "Sẵn sàng" asks only who
 * confirmed and how (the time is now), which is all POST /teams/:id/ready needs for a coordinator-recorded confirmation.
 */
export function TeamReadinessQueue({ refreshRevision, onChanged }: { refreshRevision: number; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const list = useLoadMore<Team>('response', '/teams?availability=UNAVAILABLE&status=ACTIVE', 10, open);
  const teams = list.items.filter(team => team.readiness_required);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) list.reload(); }, [revision, refreshRevision]);
  return <>
    <button type="button" className="button secondary small"
      onClick={() => { setMessage(''); setRevision(value => value + 1); setOpen(true); }}>Đội chờ xác nhận sẵn sàng</button>
    <DetailSurface modal open={open} label="Đội chờ xác nhận sẵn sàng" heading="Đội chờ xác nhận sẵn sàng" className="team-readiness-dialog" onClose={() => setOpen(false)}>
      <section className="team-ready" aria-busy={list.loading}>
        <p className="muted team-ready__hint">Đội bị dừng giữa chừng (nhiệm vụ bị hủy hoặc SOS kết thúc khi đội đang trên đường/tại hiện trường) sẽ tạm khóa đến khi đội báo đã sẵn sàng. Chỉ bấm khi đội đã báo với bạn.</p>
        {message && <p role="status" className="notice success">{message}</p>}
        {list.error && <p role="alert" className="notice error">{list.error}</p>}
        {list.loading && !teams.length && <p role="status">Đang tải…</p>}
        {!list.loading && !list.error && !teams.length && <p className="team-ready__empty">Không có đội nào đang chờ xác nhận.</p>}
        {teams.length > 0 && <ul className="team-ready__list">
          {teams.map(team => <ReadyRow key={`${team.id}-${team.version}`} team={team}
            onDone={() => { setMessage(`Đã ghi nhận ${team.name} sẵn sàng.`); setRevision(value => value + 1); onChanged(); }}
            onStale={() => { setRevision(value => value + 1); onChanged(); }} />)}
        </ul>}
        <LoadMore hasMore={list.hasMore} loading={list.loading} onClick={list.loadMore} shown={teams.length} noun="đội" />
      </section>
    </DetailSurface>
  </>;
}

function ReadyRow({ team, onDone, onStale }: { team: Team; onDone: () => void; onStale: () => void }) {
  const [editing, setEditing] = useState(false);
  return <li className="team-ready__row">
    <div className="team-ready__head">
      <strong>{team.name}</strong>
      {!editing && <button type="button" className="button small" onClick={() => setEditing(true)}>Sẵn sàng</button>}
    </div>
    {editing && <TeamReadyForm team={team} onDone={onDone} onStale={onStale} onCancel={() => setEditing(false)} />}
  </li>;
}

/** Records, on a team's behalf, that it reported ready again: how it reported and who; the time is now. */
export function TeamReadyForm({ team, onDone, onStale, onCancel }: {
  team: Pick<Team, 'id' | 'version'>; onDone: () => void; onStale: () => void; onCancel: () => void;
}) {
  const [who, setWho] = useState('');
  const [basis, setBasis] = useState<Basis>('PHONE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef<string | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!who.trim()) { setError('Ghi tên người trong đội đã báo sẵn sàng.'); return; }
    setBusy(true); setError('');
    try {
      key.current ||= newCommandKey();
      await api('response', `/teams/${team.id}/ready`, {
        method: 'POST', idempotencyKey: key.current,
        body: { expected_version: team.version, confirmation_basis: basis, reported_by: who.trim(), occurred_at: new Date().toISOString() },
      });
      onDone();
    } catch (cause) {
      if (cause instanceof ApiError && ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'].includes(cause.code)) { onStale(); return; }
      key.current = null;
      setError(cause instanceof Error ? cause.message : 'Chưa ghi nhận được. Vui lòng thử lại.');
    } finally { setBusy(false); }
  }
  return <form className="team-ready__form" onSubmit={submit} noValidate>
    <div className="team-ready__basis" role="radiogroup" aria-label="Đội báo qua">
      {bases.map(([value, name]) => <button key={value} type="button" role="radio" aria-checked={basis === value}
        className={`filter-chip${basis === value ? ' active' : ''}`}
        onClick={() => { setBasis(value); key.current = null; }}>{name}</button>)}
    </div>
    <input autoFocus value={who} maxLength={200} placeholder="Ai trong đội đã báo? (ví dụ: Anh Nam – đội trưởng)"
      aria-label="Người trong đội đã báo sẵn sàng" aria-invalid={Boolean(error)}
      onChange={event => { setWho(event.target.value); setError(''); key.current = null; }} />
    {error && <small className="field-error" role="alert">{error}</small>}
    <div className="team-ready__actions">
      <button type="button" className="button secondary small" disabled={busy} onClick={onCancel}>Hủy</button>
      <button type="submit" className="button small" disabled={busy || !who.trim()}>{busy ? 'Đang lưu…' : 'Xác nhận sẵn sàng'}</button>
    </div>
  </form>;
}
