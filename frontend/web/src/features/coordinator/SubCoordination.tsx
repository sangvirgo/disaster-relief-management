import { useEffect, useState } from 'react';
import { api, newCommandKey } from '../../api/client';
import { useUrlView } from '../../app/useUrlView';
import type { Me } from '../../auth/session';
import { Dropdown } from '../../components/ui/Dropdown';
import { EmptyState } from '../../components/ui/EmptyState';
import { Coordinator } from './Coordinator';
import { CampaignHotspots, type HotspotOverview, type HotspotTriage } from './CampaignHotspots';
import { HistorySummary, MyHistory, Timeline, type EngagementItem, type HistoryItem, type HistorySummaryData } from './CampaignHistory';
import './campaign-coordination.css';

type Engagement = EngagementItem & { last_active_at?: string };
const tabs = ['routing', 'workspace', 'history', 'my-history'] as const;
type Tab = typeof tabs[number];
const ENGAGEMENT_TTL_MINUTES = 60;
const REFRESH_MS = 60_000;

function minutesLeft(item: Engagement): number | null {
  if (!item.last_active_at) return null;
  return Math.max(0, Math.round((new Date(item.last_active_at).getTime() + ENGAGEMENT_TTL_MINUTES * 60_000 - Date.now()) / 60_000));
}

/**
 * Sub-coordinator workspace: pick a campaign from the hotspot map, then work its SOS. A sub-coordinator never sees SOS
 * without a campaign, never creates or manages campaigns, and reads only the history of campaigns it has worked on.
 */
export function SubCoordination({ user, initialRequestId = '' }: { user: Me; initialRequestId?: string }) {
  const opensSos = Boolean(initialRequestId) || Boolean(new URL(window.location.href).searchParams.get('sos_id'));
  const [tab, setTab] = useUrlView<Tab>('campaign_tab', tabs, opensSos ? 'workspace' : 'routing');
  const [triage, setTriage] = useState<HotspotTriage[]>([]);
  const [overview, setOverview] = useState<HotspotOverview[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [historyId, setHistoryId] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [summary, setSummary] = useState<HistorySummaryData | null>(null);
  const [cursor, setCursor] = useState('');
  const [myHistory, setMyHistory] = useState<Engagement[]>([]);
  const engagedIds = engagements.map((item) => item.campaign_id);
  const selected = engagements.find((item) => item.campaign_id === selectedId) ?? engagements[0];

  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    Promise.all([
      api<{ items: HotspotOverview[] }>('response', '/campaigns/overview'),
      api<{ items: HotspotTriage[] }>('response', '/campaigns/triage'),
      api<{ items: Engagement[] }>('response', '/me/engagements'),
    ]).then(([areas, ranked, mine]) => {
      if (!live) return;
      setOverview(areas.items); setTriage(ranked.items); setEngagements(mine.items);
      setSelectedId((current) => mine.items.some((item) => item.campaign_id === current) ? current : mine.items[0]?.campaign_id ?? '');
      setLoaded(true);
    }).catch((cause: unknown) => {
      if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu điều phối.');
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [refresh]);

  // Keep the hotspot map current while it is on screen.
  useEffect(() => {
    if (tab !== 'routing') return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') setRefresh((value) => value + 1); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [tab]);

  // After the first load, a sub-coordinator that already works a campaign lands on its SOS queue.
  useEffect(() => {
    if (loaded && engagements.length > 0 && !new URL(window.location.href).searchParams.get('campaign_tab')) setTab('workspace');
    // Only the first completed load decides the landing tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  async function engage(campaignId: string) {
    setLoading(true); setError('');
    try {
      await api('response', `/campaigns/${campaignId}/engage`, { method: 'POST', idempotencyKey: newCommandKey() });
      setSelectedId(campaignId); setTab('workspace'); setRefresh((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể bắt đầu điều phối chiến dịch.'); }
    finally { setLoading(false); }
  }
  async function disengage(campaignId: string) {
    setLoading(true); setError('');
    try {
      await api('response', `/campaigns/${campaignId}/disengage`, { method: 'POST', idempotencyKey: newCommandKey() });
      const remaining = engagements.filter((item) => item.campaign_id !== campaignId);
      setEngagements(remaining); setSelectedId(remaining[0]?.campaign_id ?? '');
      if (!remaining.length) setTab('routing');
      setRefresh((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể dừng điều phối chiến dịch.'); }
    finally { setLoading(false); }
  }
  function open(campaignId: string) {
    setSelectedId(campaignId); setTab('workspace');
  }
  async function loadMyHistory() {
    try { setMyHistory((await api<{ items: Engagement[] }>('response', '/me/coordination-history')).items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải lịch sử điều phối của bạn.'); }
  }
  async function showHistory(campaignId: string) {
    setHistoryId(campaignId); setHistory([]); setSummary(null); setCursor('');
    if (!campaignId) return;
    try {
      const [timeline, totals] = await Promise.all([
        api<{ items: HistoryItem[]; cursor?: string }>('response', `/campaigns/${campaignId}/history?limit=50`),
        api<HistorySummaryData>('response', `/campaigns/${campaignId}/history/summary`),
      ]);
      setHistory(timeline.items); setCursor(timeline.cursor ?? ''); setSummary(totals);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải lịch sử cứu trợ.'); }
  }
  async function loadMoreHistory() {
    if (!cursor || !historyId) return;
    try {
      const page = await api<{ items: HistoryItem[]; cursor?: string }>('response', `/campaigns/${historyId}/history?limit=50&cursor=${encodeURIComponent(cursor)}`);
      setHistory((items) => [...items, ...page.items]); setCursor(page.cursor ?? '');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải thêm lịch sử.'); }
  }
  useEffect(() => {
    if (tab === 'history' || tab === 'my-history') void loadMyHistory();
  }, [tab]);
  const workedCampaigns = [...new Map(myHistory.map((item) => [item.campaign_id, item.campaign_name ?? 'Chiến dịch'])).entries()];

  const tabTitles: Array<[Tab, string]> = [
    ['routing', 'Bản đồ điểm nóng'],
    ['workspace', engagements.length ? `Xử lý SOS (${engagements.length})` : 'Xử lý SOS'],
    ['history', 'Lịch sử'],
  ];
  const isActive = (id: Tab) => tab === id || (id === 'history' && tab === 'my-history');

  return <section className="campaign-coordination sub-coordination">
    <p className="notice sub-coordination__role" role="note">
      Bạn là <strong>điều phối viên phụ</strong>: tự chọn chiến dịch rồi xác minh, đặt ưu tiên, giao đội và theo dõi SOS trong chiến dịch đó.
      SOS chưa thuộc chiến dịch và việc tạo, quản lý chiến dịch do điều phối viên chính phụ trách.
    </p>

    {engagements.length > 0 && <div className="card sub-coordination__sessions" aria-label="Chiến dịch bạn đang điều phối">
      <span className="eyebrow">Đang điều phối {engagements.length}/3</span>
      <ul>
        {engagements.map((item) => {
          const left = minutesLeft(item);
          return <li key={item.id} className={item.campaign_id === selected?.campaign_id && tab === 'workspace' ? 'is-current' : ''}>
            <button type="button" className="sub-coordination__session" onClick={() => open(item.campaign_id)}>
              <strong>{item.campaign_name ?? 'Chiến dịch'}</strong>
              {left != null && <small>{left <= 10 ? `Sắp hết phiên (còn ${left} phút)` : `Phiên còn ${left} phút`}</small>}
            </button>
            <button type="button" className="button secondary" disabled={loading} onClick={() => void disengage(item.campaign_id)}>Dừng</button>
          </li>;
        })}
      </ul>
    </div>}

    <div className="tabs" role="tablist" aria-label="Điều phối chiến dịch">
      {tabTitles.map(([id, title]) => <button key={id} type="button" role="tab" aria-selected={isActive(id)} className={isActive(id) ? 'active' : ''}
        onClick={() => setTab(id)}>{title}</button>)}
    </div>
    {error && <p role="alert" className="notice error">{error}</p>}

    {tab === 'routing' && <CampaignHotspots triage={triage} overview={overview} engagedIds={engagedIds} loading={loading}
      onEngage={(id) => void engage(id)} onOpen={open} onRefresh={() => setRefresh((value) => value + 1)} />}

    {tab === 'workspace' && (selected
      ? <>
        {engagements.length > 1 && <div className="sub-coordination__switch" role="group" aria-label="Chọn chiến dịch để xử lý">
          {engagements.map((item) => <button key={item.id} type="button" className="hotspots__chip" aria-pressed={item.campaign_id === selected.campaign_id}
            onClick={() => setSelectedId(item.campaign_id)}>{item.campaign_name ?? 'Chiến dịch'}</button>)}
        </div>}
        <Coordinator key={selected.campaign_id} page="queue" currentUserId={user.id} user={user} campaignId={selected.campaign_id}
          initialRequestId={initialRequestId} />
      </>
      : <EmptyState title="Bạn chưa nhận chiến dịch nào"
        description="Mở bản đồ điểm nóng để xem chiến dịch nào đang có nhiều SOS gấp, rồi bấm “Nhận điều phối và xử lý”."
        action={<button type="button" className="button primary" onClick={() => setTab('routing')}>Mở bản đồ điểm nóng</button>} />)}

    {tab === 'history' && <>
      <p><button className="button secondary" type="button" onClick={() => setTab('my-history')}>Xem lịch sử điều phối của tôi</button></p>
      <label className="campaign-history-select">Chiến dịch bạn đã điều phối <Dropdown value={historyId} onChange={(event) => void showHistory(event.target.value)}>
        <option value="">Chọn chiến dịch</option>
        {workedCampaigns.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </Dropdown></label>
      {!workedCampaigns.length && <p className="empty">Bạn chưa điều phối chiến dịch nào.</p>}
      <HistorySummary summary={summary} />
      <Timeline items={history} />
      {cursor && <button className="button secondary" type="button" onClick={() => void loadMoreHistory()}>Tải các sự kiện cũ hơn</button>}
    </>}
    {tab === 'my-history' && <>
      <p><button className="button secondary" type="button" onClick={() => setTab('history')}>← Lịch sử theo chiến dịch</button></p>
      <MyHistory items={myHistory} />
    </>}
  </section>;
}
