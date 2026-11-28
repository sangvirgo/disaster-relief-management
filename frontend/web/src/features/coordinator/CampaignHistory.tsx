import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { LIST_PAGE_SIZE, useCursorNav } from '../../api/useCursorNav';
import { Dropdown } from '../../components/ui/Dropdown';
import { Pager } from '../../components/ui/Pager';
import { StatusBadge } from '../../components/StatusBadge';

export type HistoryItem = {
  occurred_at: string; event_type: string; actor: { id: string; display_name: string | null } | null;
  request_id: string | null; mission_id: string | null; tracking_code?: string | null;
  payload?: Record<string, unknown> | null;
};
export type HistorySummaryData = {
  completed_requests: number; cancelled_requests: number; open_requests: number; completed_missions: number;
  median_response_seconds: number | null; coordinators: Array<{ user_id: string; display_name: string | null; total_seconds: number }>;
};
export type EngagementItem = { id: string; campaign_id: string; campaign_name: string | null; started_at: string; ended_at?: string | null; active: boolean };

type Kind = 'coordination' | 'sos' | 'mission';
const KIND_LABEL: Record<Kind, string> = { coordination: 'Điều phối viên', sos: 'SOS', mission: 'Nhiệm vụ' };
const KIND_ICON: Record<Kind, string> = { coordination: '👤', sos: '🆘', mission: '🚑' };

// [label, kind]. Unknown codes fall back to a neutral label: raw codes are never shown to people.
const EVENTS: Record<string, [string, Kind]> = {
  COORDINATION_STARTED: ['Bắt đầu điều phối', 'coordination'], COORDINATION_LEFT: ['Dừng điều phối', 'coordination'],
  COORDINATION_EXPIRED: ['Phiên điều phối hết hạn', 'coordination'], COORDINATION_SWITCHED: ['Chuyển sang chiến dịch khác', 'coordination'],
  COORDINATION_CAMPAIGN_CLOSED: ['Chiến dịch kết thúc', 'coordination'],
  CAMPAIGN_AUTO_ATTACHED: ['SOS tự động gắn theo vị trí', 'sos'], CAMPAIGN_ATTACHED: ['SOS được gắn vào chiến dịch', 'sos'],
  CAMPAIGN_DETACHED: ['SOS được gỡ khỏi chiến dịch', 'sos'], CAMPAIGN_MATCH_CONFLICT: ['SOS nằm trong nhiều vùng chiến dịch', 'sos'],
  CLAIM_TAKEN_OVER: ['Điều phối viên tiếp quản SOS', 'sos'], REQUEST_CLAIMED: ['Điều phối viên nhận xử lý SOS', 'sos'],
  CLAIM_RELEASED: ['Điều phối viên thôi theo dõi SOS', 'sos'], REQUEST_SUBMITTED: ['SOS được tiếp nhận', 'sos'],
  VERIFICATION_STARTED: ['Bắt đầu xác minh SOS', 'sos'], REQUEST_VERIFYING: ['Bắt đầu xác minh SOS', 'sos'],
  REQUEST_VERIFIED: ['SOS đã được xác minh', 'sos'], REQUEST_TRIAGED: ['Đã đặt mức ưu tiên', 'sos'], PRIORITY_CHANGED: ['Đổi mức ưu tiên', 'sos'],
  REQUEST_RESOLVED: ['SOS đã được giải quyết', 'sos'], REQUEST_CLOSED: ['SOS đã đóng', 'sos'], REQUEST_CANCELLED: ['SOS bị hủy', 'sos'],
  REQUEST_REJECTED: ['SOS bị từ chối', 'sos'], REQUEST_DUPLICATED: ['SOS bị trùng', 'sos'], REQUEST_REOPENED: ['SOS được mở lại', 'sos'],
  REPORTER_SUPPLEMENT: ['Người báo bổ sung thông tin', 'sos'], SUPPLEMENT_REVIEWED: ['Đã rà soát thông tin bổ sung', 'sos'],
  AI_ADVISORY_REQUESTED: ['Yêu cầu AI đánh giá', 'sos'], AI_ADVISORY_REVIEW: ['Đã rà soát gợi ý AI', 'sos'],
  MISSION_OFFERED: ['Đã đề nghị nhiệm vụ cho đội', 'mission'], MISSION_ASSIGNED: ['Đã giao nhiệm vụ', 'mission'],
  MISSION_ACCEPTED: ['Đội cứu hộ nhận nhiệm vụ', 'mission'], MISSION_DECLINED: ['Đội cứu hộ từ chối nhiệm vụ', 'mission'],
  MISSION_EN_ROUTE: ['Đội đang di chuyển', 'mission'], MISSION_ARRIVED: ['Đội đã đến hiện trường', 'mission'],
  MISSION_IN_PROGRESS: ['Đang xử lý tại hiện trường', 'mission'], MISSION_COMPLETED: ['Nhiệm vụ hoàn tất', 'mission'],
  MISSION_FAILED: ['Nhiệm vụ không thành công', 'mission'], MISSION_CANCELLED: ['Nhiệm vụ bị hủy', 'mission'],
};
const describe = (type: string): [string, Kind] =>
  EVENTS[type] ?? [type.startsWith('MISSION_') ? 'Cập nhật nhiệm vụ' : type.startsWith('COORDINATION_') ? 'Cập nhật điều phối' : 'Cập nhật SOS',
    type.startsWith('MISSION_') ? 'mission' : type.startsWith('COORDINATION_') ? 'coordination' : 'sos'];

const dateTime = (value: string) => new Date(value).toLocaleString('vi-VN');
const time = (value: string) => new Date(value).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
const day = (value: string) => new Date(value).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
function minutes(seconds: number) {
  const total = Math.max(0, Math.round(seconds / 60));
  return total >= 60 ? `${Math.floor(total / 60)} giờ ${total % 60} phút` : `${total} phút`;
}

export function HistorySummary({ summary }: { summary: HistorySummaryData | null }) {
  if (!summary) return null;
  const tiles: Array<[string, string, string]> = [
    [String(summary.completed_requests), 'SOS hoàn tất', 'good'], [String(summary.open_requests), 'SOS còn mở', 'warn'],
    [String(summary.cancelled_requests), 'SOS hủy / từ chối', 'muted'], [String(summary.completed_missions), 'Nhiệm vụ hoàn tất', 'good'],
    [summary.median_response_seconds == null ? '—' : minutes(summary.median_response_seconds), 'Phản hồi trung vị', 'info'],
  ];
  return <section className="history-summary" aria-label="Tổng kết cứu trợ">
    <div className="history-tiles">{tiles.map(([value, label, tone]) => <div key={label} className={`history-tile history-tile--${tone}`}><b>{value}</b><span>{label}</span></div>)}</div>
    {summary.coordinators.length > 0 && <p className="history-people"><span>Điều phối viên đã tham gia:</span>{summary.coordinators.map((person) =>
      <em key={person.user_id}>{person.display_name ?? 'Người dùng'} · {minutes(person.total_seconds)}</em>)}</p>}
  </section>;
}

export function Timeline({ items }: { items: HistoryItem[] }) {
  const [filter, setFilter] = useState<'ALL' | Kind>('ALL');
  const shown = useMemo(() => items.filter((item) => filter === 'ALL' || describe(item.event_type)[1] === filter), [items, filter]);
  const groups = useMemo(() => {
    const byDay = new Map<string, HistoryItem[]>();
    for (const item of shown) {
      const key = day(item.occurred_at);
      byDay.set(key, [...(byDay.get(key) ?? []), item]);
    }
    return [...byDay.entries()];
  }, [shown]);
  return <section className="history-timeline" aria-label="Dòng thời gian cứu trợ">
    <div className="history-filter" role="group" aria-label="Lọc sự kiện">
      {(['ALL', 'sos', 'mission', 'coordination'] as const).map((key) => <button key={key} type="button" aria-pressed={filter === key}
        className={filter === key ? 'active' : ''} onClick={() => setFilter(key)}>{key === 'ALL' ? 'Tất cả' : KIND_LABEL[key]}</button>)}
    </div>
    {groups.map(([label, events]) => <div key={label} className="history-day">
      <h3>{label}</h3>
      <ol>{events.map((item, index) => {
        const [title, kind] = describe(item.event_type);
        const note = [item.payload?.reason, item.payload?.outcome_note].find((value): value is string => typeof value === 'string' && value.trim().length > 0);
        return <li key={`${item.occurred_at}:${item.event_type}:${item.request_id ?? item.mission_id ?? ''}:${index}`} className={`history-event history-event--${kind}`}>
          <span className="history-event__icon" aria-hidden="true">{KIND_ICON[kind]}</span>
          <div>
            <p className="history-event__title">{title}{item.tracking_code && <span className="history-code">{item.tracking_code}</span>}</p>
            <p className="history-event__meta"><time dateTime={item.occurred_at} title={dateTime(item.occurred_at)}>{time(item.occurred_at)}</time> · {item.actor?.display_name ?? (item.actor ? 'Người dùng' : 'Hệ thống')}</p>
            {note && <p className="history-event__note">{note}</p>}
          </div>
        </li>;
      })}</ol>
    </div>)}
    {!groups.length && <p className="empty">{items.length ? 'Không có sự kiện thuộc nhóm này.' : 'Chưa có sự kiện trong lịch sử.'}</p>}
  </section>;
}

export function MyHistory({ items }: { items: EngagementItem[] }) {
  if (!items.length) return <p className="empty">Bạn chưa có phiên điều phối nào.</p>;
  return <ul className="history-sessions">{items.map((item) => <li key={item.id}>
    <div><strong>{item.campaign_name ?? 'Chiến dịch'}</strong>
      <p className="muted">{dateTime(item.started_at)} → {item.active ? 'hiện tại' : item.ended_at ? dateTime(item.ended_at) : 'phiên hết hạn'}</p></div>
    <span className={`history-badge${item.active ? ' history-badge--live' : ''}`}>{item.active ? 'Đang điều phối' : 'Đã kết thúc'}</span>
  </li>)}</ul>;
}

const HISTORY_PAGE_SIZE = 30;
type HistoryCampaign = { id: string; name: string; status: string };

/**
 * Lịch sử tab: one switch between a campaign's timeline and the coordinator's own sessions. A campaign is preselected
 * (the one the coordinator works, else the first listed) so the tab never opens empty; events are paged by cursor.
 */
export function CampaignHistoryTab({ campaigns, campaignId, preferredIds, onCampaignChange, initialMode = 'campaign' }: {
  campaigns: HistoryCampaign[]; campaignId: string; preferredIds: string[];
  onCampaignChange: (id: string) => void; initialMode?: 'campaign' | 'mine';
}) {
  const [mode, setMode] = useState<'campaign' | 'mine'>(initialMode);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [summary, setSummary] = useState<HistorySummaryData | null>(null);
  const [mine, setMine] = useState<EngagementItem[] | null>(null);
  const [minePage, setMinePage] = useState(0);
  const [cursor, setCursor, prevPage, pageIndex] = useCursorNav<string>('');
  const [next, setNext] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const selected = campaigns.find((campaign) => campaign.id === campaignId);

  useEffect(() => {
    if (mode !== 'campaign' || campaignId || !campaigns.length) return;
    onCampaignChange(campaigns.find((campaign) => preferredIds.includes(campaign.id))?.id ?? campaigns[0]!.id);
  }, [mode, campaignId, campaigns, preferredIds, onCampaignChange]);
  useEffect(() => { setCursor(''); }, [campaignId, setCursor]);
  useEffect(() => {
    if (mode !== 'campaign' || !campaignId) return;
    let live = true;
    setLoading(true); setError('');
    const params = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) });
    if (cursor) params.set('cursor', cursor);
    void Promise.all([
      api<{ items: HistoryItem[]; cursor?: string; more?: boolean }>('response', `/campaigns/${campaignId}/history?${params}`),
      cursor ? Promise.resolve(null) : api<HistorySummaryData>('response', `/campaigns/${campaignId}/history/summary`),
    ]).then(([page, totals]) => {
      if (!live) return;
      setItems(page.items); setNext(page.more === false ? '' : page.cursor ?? '');
      if (totals) setSummary(totals);
    }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải lịch sử cứu trợ.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [mode, campaignId, cursor]);
  useEffect(() => {
    if (mode !== 'mine' || mine) return;
    let live = true;
    setLoading(true); setError('');
    void api<{ items: EngagementItem[] }>('response', '/me/coordination-history')
      .then((value) => { if (live) setMine(value.items); })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải lịch sử điều phối của bạn.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [mode, mine]);

  const mineItems = mine ?? [];
  const mineShown = mineItems.slice(minePage * LIST_PAGE_SIZE, (minePage + 1) * LIST_PAGE_SIZE);
  return <section className="history-tab">
    <div className="filter-bar history-toolbar">
      <div className="segmented" role="group" aria-label="Chọn loại lịch sử">
        <button type="button" aria-pressed={mode === 'campaign'} onClick={() => setMode('campaign')}>Theo chiến dịch</button>
        <button type="button" aria-pressed={mode === 'mine'} onClick={() => setMode('mine')}>Phiên điều phối của tôi</button>
      </div>
      {mode === 'campaign' && <span className="filter-bar__select history-toolbar__campaign">
        <Dropdown value={campaignId} aria-label="Chiến dịch" onChange={(event) => onCampaignChange(event.target.value)}>
          {!campaigns.length && <option value="">Chưa có chiến dịch</option>}
          {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
        </Dropdown>
      </span>}
      {mode === 'campaign' && selected && <span className="filter-bar__summary"><StatusBadge status={selected.status} /></span>}
    </div>
    {error && <p className="notice error" role="alert">{error}</p>}
    {loading && <p role="status" className="muted">Đang tải lịch sử…</p>}
    {mode === 'campaign' && <>
      {!campaigns.length && !loading && <p className="empty">Chưa có chiến dịch trong phạm vi được cấp quyền.</p>}
      {selected && <HistorySummary summary={summary} />}
      {selected && <Timeline items={items} />}
      {selected && <Pager page={pageIndex} hasNext={Boolean(next)} loading={loading} count={items.length} noun="sự kiện"
        onPrev={prevPage} onNext={() => next && setCursor(next)} />}
    </>}
    {mode === 'mine' && mine && <>
      <MyHistory items={mineShown} />
      <Pager page={minePage} hasNext={(minePage + 1) * LIST_PAGE_SIZE < mineItems.length} loading={loading} count={mineShown.length} noun="phiên"
        onPrev={() => setMinePage((value) => Math.max(0, value - 1))} onNext={() => setMinePage((value) => value + 1)} />
    </>}
  </section>;
}
