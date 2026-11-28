import { useMemo, useState } from 'react';
import { CampaignAreaMap, type AreaMapCampaign } from '../../maps/CampaignAreaMap';
import { Badge } from '../../components/ui/Badge';
import { Pager } from '../../components/ui/Pager';
import { LIST_PAGE_SIZE, useCursorNav } from '../../api/useCursorNav';

export type HotspotTriage = {
  id: string; name: string;
  urgency: {
    highest_priority: string | null; highest_priority_unhandled_count: number;
    unhandled_priority_counts: Record<string, number>; overdue_count: number;
    longest_wait_seconds: number; active_coordinator_count: number; reason_codes: string[];
  };
  urgency_reasons_vi: string[];
};
export type HotspotOverview = {
  id: string; name: string; status: string; center: { lat: number; lng: number } | null; radius_m: number | null;
  request_counts: Record<string, number>; overdue_count: number; has_active_coordinator: boolean;
};

// Fallback copy when the server sends only reason codes; codes are never shown to people.
const reasonLabel: Record<string, string> = {
  P1_UNHANDLED: 'Có SOS P1 chưa được xử lý', P2_UNHANDLED: 'Có SOS P2 chưa được xử lý',
  P3_UNHANDLED: 'Có SOS P3 chưa được xử lý', P4_UNHANDLED: 'Có SOS P4 chưa được xử lý',
  OVERDUE: 'Có SOS quá hạn', LONG_WAIT: 'Có SOS chờ lâu',
  NO_COORDINATOR: 'Chưa có điều phối viên tham gia', ROUTINE: 'Không có dấu hiệu gấp nổi bật',
};
const CLOSED = ['RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED', 'DUPLICATE'];
const MAX_ENGAGEMENTS = 3;
type Filter = 'all' | 'unattended' | 'p1';
const FILTERS: Array<[Filter, string]> = [['all', 'Tất cả'], ['unattended', 'Chưa có người xử lý'], ['p1', 'Có SOS P1']];

type Hotspot = {
  id: string; name: string; rank: number; open: number; p1: number; p2: number; overdue: number;
  coordinators: number; waitMinutes: number; reasons: string[]; score: number; heat: number;
  center: { lat: number; lng: number } | null; radius_m: number | null;
};

function openCount(counts: Record<string, number> | undefined): number {
  return Object.entries(counts ?? {}).filter(([status]) => !CLOSED.includes(status)).reduce((sum, [, value]) => sum + value, 0);
}

/** Weighted backlog used only to tint the map; the list keeps the server triage order (P1, P2, overdue, wait, fewer coordinators). */
function backlogScore(item: Omit<Hotspot, 'score' | 'heat' | 'rank'>): number {
  return item.p1 * 5 + item.p2 * 3 + item.overdue * 2 + Math.min(item.open, 20) + (item.coordinators === 0 && item.open > 0 ? 3 : 0);
}

function waitLabel(minutes: number): string {
  if (minutes < 1) return 'vừa gửi';
  if (minutes < 60) return `chờ lâu nhất ${minutes} phút`;
  return `chờ lâu nhất ${Math.floor(minutes / 60)} giờ ${minutes % 60} phút`;
}

/**
 * Hotspot view for choosing a campaign: a map tinted by backlog plus the ranked list of ACTIVE campaigns. One click takes
 * a campaign and opens its SOS queue. Ranking is advisory; the coordinator decides which campaign to work.
 */
export function CampaignHotspots({ triage, overview, engagedIds, loading, onEngage, onOpen, onRefresh, showRefresh = true }: {
  triage: HotspotTriage[]; overview: HotspotOverview[]; engagedIds: string[]; loading: boolean;
  onEngage: (campaignId: string) => void; onOpen: (campaignId: string) => void; onRefresh: () => void;
  showRefresh?: boolean;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cursor, setCursor, prevPage] = useCursorNav<string>('');
  const page = Number(cursor || 0);
  const [query, setQuery] = useState('');
  const limitReached = engagedIds.length >= MAX_ENGAGEMENTS;

  const hotspots = useMemo<Hotspot[]>(() => {
    const byId = new Map(overview.map((item) => [item.id, item]));
    const base = triage.map((item, index) => {
      const area = byId.get(item.id);
      const counts = item.urgency.unhandled_priority_counts ?? {};
      const entry = {
        id: item.id, name: item.name, open: openCount(area?.request_counts), p1: counts.P1 ?? 0, p2: counts.P2 ?? 0,
        overdue: item.urgency.overdue_count, coordinators: item.urgency.active_coordinator_count,
        waitMinutes: Math.floor(item.urgency.longest_wait_seconds / 60),
        reasons: item.urgency_reasons_vi?.length ? item.urgency_reasons_vi : item.urgency.reason_codes.map((code) => reasonLabel[code] ?? 'Cần theo dõi'),
        center: area?.center ?? null, radius_m: area?.radius_m ?? null,
      };
      return { ...entry, rank: index + 1, score: backlogScore(entry), heat: 0 };
    });
    const max = Math.max(0, ...base.map((item) => item.score));
    return base.map((item) => ({ ...item, heat: max ? item.score / max : 0 }));
  }, [triage, overview]);

  const matching = hotspots.filter(item => item.name.toLocaleLowerCase('vi-VN').includes(query.trim().toLocaleLowerCase('vi-VN')));
  const visible = matching.filter((item) => filter === 'all'
    || (filter === 'unattended' && item.coordinators === 0 && item.open > 0)
    || (filter === 'p1' && item.p1 > 0));
  const pageCount = Math.max(1, Math.ceil(visible.length / LIST_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageItems = visible.slice(currentPage * LIST_PAGE_SIZE, (currentPage + 1) * LIST_PAGE_SIZE);
  const suggestion = visible.find((item) => !engagedIds.includes(item.id) && (item.p1 + item.p2 + item.overdue > 0 || item.open > 0));
  const mapCampaigns: AreaMapCampaign[] = visible.filter((item) => item.center && item.radius_m).map((item) => ({
    id: item.id, name: item.name, status: 'ACTIVE', center: item.center!, radius_m: item.radius_m!, heat: item.heat,
    summary: `${item.open} SOS mở${item.p1 ? ` · ${item.p1} P1` : ''}`, label: item.rank,
  }));
  const totals = hotspots.reduce((sum, item) => ({ open: sum.open + item.open, p1: sum.p1 + item.p1, overdue: sum.overdue + item.overdue,
    unattended: sum.unattended + (item.coordinators === 0 && item.open > 0 ? 1 : 0) }), { open: 0, p1: 0, overdue: 0, unattended: 0 });

  function changeFilter(next: Filter) {
    setFilter(next); setCursor(''); setSelectedId(null);
  }
  const selected = visible.find(item => item.id === selectedId);
  function select(id: string, fromList = false) {
    setSelectedId((current) => (current === id ? null : id));
    const index = visible.findIndex((item) => item.id === id);
    if (index >= 0) setCursor(Math.floor(index / LIST_PAGE_SIZE) ? String(Math.floor(index / LIST_PAGE_SIZE)) : '');
    if (fromList || window.matchMedia('(max-width: 1100px)').matches) requestAnimationFrame(() => {
      const target = window.matchMedia('(max-width: 1100px)').matches ? 'hotspot-map-details' : 'hotspot-map-view';
      document.getElementById(target)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  function action(item: Hotspot, primary = false) {
    const engaged = engagedIds.includes(item.id);
    const size = primary ? '' : ' small';
    if (engaged) return <button type="button" className={`button ${primary ? 'primary' : 'secondary'}${size}`} onClick={() => onOpen(item.id)}>Mở hàng đợi SOS</button>;
    return <button type="button" className={`button ${primary ? 'primary' : 'secondary'}${size}`} disabled={loading || limitReached}
      title={limitReached ? 'Bạn đang điều phối tối đa 3 chiến dịch. Hãy dừng một chiến dịch trước.' : undefined}
      onClick={() => onEngage(item.id)}>Nhận điều phối và xử lý</button>;
  }

  return <section className="hotspots" aria-label="Chọn chiến dịch cần hỗ trợ">
    {showRefresh && <header className="hotspots__header">
      <div>
        <span className="eyebrow">Chọn chiến dịch cần xử lý</span>
        <h2 id="hotspots-title">Chiến dịch cần hỗ trợ</h2>
        <p className="muted">So sánh SOS đang chờ rồi chọn chiến dịch để bắt đầu. Thứ tự là gợi ý, bạn quyết định.</p>
      </div>
      {showRefresh && <button type="button" className="button secondary refresh-action" disabled={loading} onClick={onRefresh}>Làm mới</button>}
    </header>}

    <dl className="hotspots__totals" aria-label="Tổng quan các chiến dịch đang hoạt động">
      <div><dt>Chiến dịch hoạt động</dt><dd>{hotspots.length}</dd></div>
      <div><dt>SOS đang mở</dt><dd>{totals.open}</dd></div>
      <div className={totals.p1 ? 'is-alert' : ''}><dt>P1 chưa xử lý</dt><dd>{totals.p1}</dd></div>
      <div className={totals.overdue ? 'is-warn' : ''}><dt>SOS quá hạn</dt><dd>{totals.overdue}</dd></div>
      <div className={totals.unattended ? 'is-alert' : ''}><dt>Chưa có điều phối viên</dt><dd>{totals.unattended}</dd></div>
    </dl>

    {suggestion && <div className="hotspots__suggestion" role="status">
      <div>
        <strong>Gợi ý: {suggestion.name}</strong>
        <span>{suggestion.reasons[0] || `${suggestion.open} SOS đang mở`}</span>
      </div>
      {action(suggestion, true)}
    </div>}
    {limitReached && <p className="notice" role="status">Bạn đang điều phối tối đa 3 chiến dịch. Dừng một chiến dịch để nhận thêm.</p>}

    <div className="filter-bar hotspots__filters" role="group" aria-label="Lọc chiến dịch">
      <label className="filter-search"><input type="search" aria-label="Tìm chiến dịch" placeholder="Tìm theo tên chiến dịch" value={query} onChange={event => { setQuery(event.target.value); setCursor(''); setSelectedId(null); }} /></label>
      {FILTERS.map(([id, title]) => <button key={id} type="button" className="hotspots__chip" aria-pressed={filter === id} onClick={() => changeFilter(id)}>
        {title}
      </button>)}
      <span className="filter-bar__summary">{visible.length} chiến dịch</span>
    </div>

    <div id="hotspot-map-view" className={`hotspots__map-frame${selected ? ' hotspots__map-frame--selected' : ''}`}>
      <div className="hotspots__map">
        {mapCampaigns.length > 0
          ? <CampaignAreaMap requests={[]} campaigns={mapCampaigns} height="clamp(380px, 68dvh, 720px)" selectedCampaignId={selectedId} showLegend={false}
            onCampaignSelect={id => select(id)} ariaLabel="Bản đồ điểm nóng các chiến dịch đang hoạt động"
            note={<><span><i className="hotspots__swatch hotspots__swatch--hot" aria-hidden="true" /> Nhiều SOS gấp</span>
              <span><i className="hotspots__swatch hotspots__swatch--warm" aria-hidden="true" /> Cần chú ý</span>
              <span><i className="hotspots__swatch hotspots__swatch--calm" aria-hidden="true" /> Ổn định</span></>} />
          : <p className="empty">{loading ? 'Đang tải bản đồ…' : 'Chưa có chiến dịch đang hoạt động có vùng trên bản đồ.'}</p>}
      </div>
      {selected && <aside id="hotspot-map-details" className="hotspots__selection" aria-label="Thông tin chiến dịch đang chọn" aria-live="polite">
        <div className="hotspots__selection-head"><span className="eyebrow">Chiến dịch #{selected.rank}</span><button type="button" className="button secondary small" aria-label="Đóng thông tin chiến dịch" onClick={() => setSelectedId(null)}>Đóng</button></div>
        <h3>{selected.name}</h3>
        {engagedIds.includes(selected.id) && <Badge tone="info" kind="meta">Bạn đang điều phối</Badge>}
        <dl className="hotspots__selection-metrics"><div><dt>SOS mở</dt><dd>{selected.open}</dd></div><div><dt>P1 chưa xử lý</dt><dd>{selected.p1}</dd></div><div><dt>Quá hạn</dt><dd>{selected.overdue}</dd></div><div><dt>Điều phối viên</dt><dd>{selected.coordinators}</dd></div></dl>
        {selected.open > 0 && <p>{waitLabel(selected.waitMinutes)}</p>}
        {selected.reasons.length > 0 && <p className="muted">{selected.reasons.join(' · ')}</p>}
        {action(selected, true)}
      </aside>}
    </div>
    <div className="hotspots__compact-list">
      <h3>Danh sách chiến dịch</h3>
      <p className="muted">Chọn tên để xem vùng và thông tin trên bản đồ, hoặc mở hàng đợi ngay.</p>
      {pageItems.length === 0 && !loading && <p className="empty">Không có chiến dịch phù hợp bộ lọc.</p>}
      {pageItems.length > 0 && <div className="hotspots__table-wrap" role="region" aria-label="Danh sách chiến dịch cần hỗ trợ" tabIndex={0}>
        <table className="hotspots__table"><thead><tr><th scope="col">Chiến dịch</th><th scope="col">SOS mở</th><th scope="col">P1</th><th scope="col">Quá hạn</th><th scope="col">Điều phối viên</th><th scope="col">Thao tác</th></tr></thead><tbody>
          {pageItems.map(item => <tr key={item.id} className={selectedId === item.id ? 'is-selected' : ''}>
            <td><button type="button" className="hotspots__table-name" aria-label={`Xem ${item.name} trên bản đồ`} aria-pressed={selectedId === item.id} onClick={() => select(item.id, true)}><span className="hotspot-card__rank">{item.rank}</span><strong>{item.name}</strong></button>{engagedIds.includes(item.id) && <small className="hotspots__engaged-label">Bạn đang điều phối</small>}</td>
            <td>{item.open}</td><td className={item.p1 ? 'hotspot-card__alert' : ''}>{item.p1}</td><td>{item.overdue}</td><td>{item.coordinators || <span className={item.open ? 'hotspot-card__alert' : ''}>Chưa có</span>}</td><td>{action(item)}</td>
          </tr>)}
        </tbody></table>
      </div>}
      <Pager page={currentPage} hasNext={currentPage < pageCount - 1} loading={loading} count={pageItems.length} noun="chiến dịch"
        onPrev={prevPage} onNext={() => setCursor(String(Math.min(pageCount - 1, currentPage + 1)))} />
    </div>
  </section>;
}
