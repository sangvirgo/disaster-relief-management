import { useState } from 'react';
import { useCursorPages } from '../../api/useCursorPages';
import { LIST_PAGE_SIZE } from '../../api/useCursorNav';
import { ListNav } from '../../components/ui/Pager';
import { CoordinatorTeamPositionForm } from './CoordinatorTeamPositionForm';
import { TeamReadyForm } from './TeamReadinessQueue';

type ExternalTeam = {
  id: string; name: string; version: number; availability: 'AVAILABLE' | 'UNAVAILABLE'; readiness_required: boolean;
  external_contact_note?: string | null; position: { age_s: number } | null;
};

const FRESH_S = 30 * 60;

function ageText(seconds: number): string {
  if (seconds < 60) return 'vừa xong';
  if (seconds < 3600) return `${Math.round(seconds / 60)} phút trước`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} giờ trước`;
  return `${Math.round(seconds / 86_400)} ngày trước`;
}

/**
 * Teams without accounts (police, army, local groups) report through a coordinator. Every such team is listed here with
 * its contact and state, and the coordinator can always report its position or record that it is ready again —
 * the actions no longer depend on the team appearing in the candidate list.
 */
export function ExternalTeamsPanel({ onChanged }: { onChanged: () => void }) {
  const list = useCursorPages<ExternalTeam>('response', '/teams?status=ACTIVE&reporting_mode=COORDINATOR', LIST_PAGE_SIZE);
  const [open, setOpen] = useState<{ id: string; action: 'position' | 'ready' } | null>(null);
  const [message, setMessage] = useState('');
  const done = (text: string) => { setOpen(null); setMessage(text); list.reload(); onChanged(); };

  return <section className="external-teams" aria-labelledby="external-teams-title">
    <div className="external-teams__head">
      <div>
        <h3 id="external-teams-title">Đội ngoài hệ thống</h3>
        <p className="muted">Đội không có tài khoản (công an, quân đội, đội địa phương). Bạn báo vị trí và tiến độ thay đội.</p>
      </div>
      <button type="button" className="icon-button" title="Tải lại" aria-label="Tải lại đội ngoài hệ thống" disabled={list.loading} onClick={list.reload}><span aria-hidden="true">↻</span></button>
    </div>
    {message && <p className="notice success" role="status">{message}</p>}
    {list.error && <p className="notice error" role="alert">{list.error}</p>}
    {list.loading && !list.items.length && <p role="status">Đang tải…</p>}
    {!list.loading && !list.error && !list.items.length && <p className="external-teams__empty">Chưa có đội ngoài hệ thống. Tạo đội với kiểu báo cáo “Qua điều phối viên” ở trang Đội cứu hộ.</p>}
    {list.items.length > 0 && <div className="external-teams__scroll" role="region" aria-label="Bảng đội ngoài hệ thống" tabIndex={0}>
      <table className="external-teams__table">
        <thead><tr><th scope="col">Đội</th><th scope="col">Trạng thái</th><th scope="col">Vị trí</th><th scope="col">Thao tác</th></tr></thead>
        <tbody>{list.items.map((team) => {
          const locked = team.readiness_required;
          const resting = !locked && team.availability === 'UNAVAILABLE';
          const fresh = team.position !== null && team.position.age_s <= FRESH_S;
          const expanded = open?.id === team.id ? open.action : null;
          return [
            <tr key={team.id}>
              <th scope="row"><span className="external-teams__name">{team.name}</span>
                {team.external_contact_note && <small>{team.external_contact_note}</small>}</th>
              <td>{locked ? <span className="ext-pill ext-pill--warn">Chờ báo sẵn sàng</span>
                : resting ? <span className="ext-pill">Đang nghỉ</span>
                  : <span className="ext-pill ext-pill--ok">Sẵn sàng</span>}</td>
              <td>{team.position === null ? <span className="ext-pill ext-pill--warn">Chưa có</span>
                : <span className={fresh ? 'external-teams__age' : 'external-teams__age external-teams__age--old'}>{ageText(team.position.age_s)}{fresh ? '' : ' · cũ'}</span>}</td>
              <td className="external-teams__actions">
                <button type="button" className={`button small${!fresh && !locked && !resting ? '' : ' secondary'}`} aria-expanded={expanded === 'position'}
                  onClick={() => setOpen(expanded === 'position' ? null : { id: team.id, action: 'position' })}>Báo vị trí</button>
                {locked && <button type="button" className="button small" aria-expanded={expanded === 'ready'}
                  onClick={() => setOpen(expanded === 'ready' ? null : { id: team.id, action: 'ready' })}>Sẵn sàng</button>}
              </td>
            </tr>,
            expanded && <tr key={`${team.id}-form`} className="external-teams__form-row"><td colSpan={4}>
              {expanded === 'position'
                ? <CoordinatorTeamPositionForm teamId={team.id} teamName={team.name} onSuccess={() => done(`Đã cập nhật vị trí ${team.name}.`)} />
                : <TeamReadyForm team={team} onCancel={() => setOpen(null)} onStale={() => { setOpen(null); list.reload(); }}
                  onDone={() => done(`Đã ghi nhận ${team.name} sẵn sàng.`)} />}
            </td></tr>,
          ];
        })}</tbody>
      </table>
    </div>}
    <ListNav page={list.page} hasNext={list.hasNext} loading={list.loading} onPrev={list.prev} onNext={list.next} count={list.items.length} noun="đội" />
  </section>;
}
