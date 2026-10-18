import { useEffect, useState } from 'react';
import { api, newCommandKey } from '../../api/client';
import { label, timeLabel } from '../../i18n/labels';
import type { components as ResponseComponents } from '../../api/generated/response';
import { googleMapsDirectionsUrl } from '../../maps/googleMaps';

type Mission = ResponseComponents['schemas']['MissionView'];
type Team = { id: string; name: string; kind: string; reporting_mode: string; availability: string; status: string; skills: string[]; position: null | { age_s: number; accuracy_m: number | null; source: string } };
type Notice = ResponseComponents['schemas']['Notice'];
const noticeNames: Record<string, string> = { MISSION_OFFERED: 'Có nhiệm vụ mới', MISSION_OVERDUE: 'Nhiệm vụ cần chú ý', MISSION_ACCEPTED: 'Nhiệm vụ đã được nhận', REQUEST_UPDATED: 'Yêu cầu đã cập nhật', DONATION_COUNTED: 'Vật phẩm đã kiểm đếm', DONATION_REVIEWED: 'Đóng góp đã được duyệt' };

export function Notices() {
  const [items, setItems] = useState<Notice[]>([]); const [cursor, setCursor] = useState(''); const [next, setNext] = useState(''); const [error, setError] = useState(''); const [revision, setRevision] = useState(0);
  useEffect(() => { let live = true; api<{ items: Notice[]; cursor?: string }>('response', `/notices${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`)
    .then((value) => { if (live) { setItems(value.items); setNext(value.cursor || ''); } }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải thông báo.'); }); return () => { live = false; }; }, [cursor, revision]);
  async function markRead(id: string) { setError(''); try { await api('response', `/notices/${id}/read`, { method: 'POST', idempotencyKey: newCommandKey() }); setRevision((value) => value + 1); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể đánh dấu đã đọc.'); } }
  return <section className="card"><h2>Thông báo của tôi</h2>{error && <p role="alert" className="notice error">{error}</p>}{!items.length && !error && <div className="empty">Chưa có thông báo.</div>}
    <div className="record-list">{items.map((item) => <article className="record" key={item.id}><div><strong>{noticeNames[item.notice_type] || 'Có cập nhật mới'}</strong><p>{timeLabel(item.created_at)}</p><small>{item.read_at ? 'Đã đọc' : 'Chưa đọc'}</small></div>{!item.read_at && <button className="button secondary" onClick={() => markRead(item.id)}>Đánh dấu đã đọc</button>}</article>)}</div>
    {next && <button className="button secondary" onClick={() => setCursor(next)}>Xem thêm</button>}</section>;
}

export function Volunteer({ page }: { page: string }) {
  const isTeam = page === 'team';
  const [items, setItems] = useState<Mission[] | Team[]>([]);
  const [cursor, setCursor] = useState(''); const [next, setNext] = useState(''); const [error, setError] = useState('');
  const [selected, setSelected] = useState<Mission | null>(null);
  const directionsUrl = selected && googleMapsDirectionsUrl(selected.location);
  useEffect(() => { let live = true; setError(''); const path = isTeam ? '/teams' : '/missions/mine';
    api<{ items: Mission[] | Team[]; cursor?: string }>('response', `${path}${cursor ? '?cursor=' + encodeURIComponent(cursor) : ''}`)
      .then((value) => { if (live) { setItems(value.items); setNext(value.cursor || ''); } }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu.'); }); return () => { live = false; }; }, [isTeam, cursor]);
  return <div className="grid-two"><section className="card"><h2>{isTeam ? 'Đội của tôi' : page === 'progress' ? 'Tiến độ nhiệm vụ' : 'Nhiệm vụ của tôi'}</h2>
    {error && <p role="alert" className="notice error">{error}</p>}{!items.length && !error && <div className="empty">Chưa có dữ liệu trong phạm vi của bạn.</div>}
    <div className="record-list">{isTeam ? (items as Team[]).map((team) => <article className="record" key={team.id}><div><strong>{team.name}</strong><p>{label(team.kind)} · {label(team.availability)}</p><p>Kỹ năng: {team.skills.length ? team.skills.join(', ') : 'Chưa có'}</p><small>{team.position ? `Vị trí cập nhật ${Math.round(team.position.age_s / 60)} phút trước` : 'Chưa có vị trí'}</small></div></article>)
      : (items as Mission[]).map((mission) => <article className="record" key={mission.id}><div><strong>{mission.team.name}</strong><p>{label(mission.category)} · {label(mission.status)}</p><small>{timeLabel(mission.created_at)}</small></div><button className="button secondary" onClick={() => setSelected(mission)}>Xem nhiệm vụ</button></article>)}</div>
    {next && <button className="button secondary" onClick={() => setCursor(next)}>Xem thêm</button>}</section>
    <section className="card"><h2>Chi tiết</h2>{!selected && <div className="empty">Chọn một nhiệm vụ để xem thông tin được cấp quyền.</div>}{selected && <><p><strong>Đội:</strong> {selected.team.name}</p><p><strong>Trạng thái:</strong> {label(selected.status)}</p><p><strong>Loại sự cố:</strong> {label(selected.category)}</p><p><strong>Số người:</strong> {selected.people_affected ?? 'Chưa rõ'}</p><p>{selected.description}</p>
      {directionsUrl ? <div className="mission-location"><h3>Vị trí cần hỗ trợ</h3><p>Tọa độ: {(selected.location as { coordinates: [number, number] }).coordinates[1]}, {(selected.location as { coordinates: [number, number] }).coordinates[0]}</p><a className="button mission-directions" href={directionsUrl} target="_blank" rel="noopener noreferrer" aria-label="Mở Google Maps để chỉ đường tới vị trí nhiệm vụ">Mở Google Maps chỉ đường</a></div> : <p className="notice">Nhiệm vụ này chưa có tọa độ được cấp quyền để mở chỉ đường.</p>}
      <p className="notice">Bạn có thể theo dõi tiến độ tại đây. Các thao tác điều hành chỉ hiển thị khi tài khoản được xác định là đội trưởng của nhiệm vụ.</p></>}</section></div>;
}
