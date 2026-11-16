import { useEffect, useState } from 'react';
import { api, newCommandKey } from '../../api/client';
import type { Me } from '../../auth/session';
import { Coordinator } from './Coordinator';
import { Campaigns } from './Campaigns';
import { CommonQueueSuggestions } from './CommonQueueSuggestions';
import { HistorySummary, MyHistory, Timeline, type EngagementItem, type HistoryItem, type HistorySummaryData } from './CampaignHistory';

type TriageCampaign = {
  id: string; name: string; urgency: {
    highest_priority: string | null; highest_priority_unhandled_count: number;
    unhandled_priority_counts: Record<string, number>; overdue_count: number;
    longest_wait_seconds: number; active_coordinator_count: number; reason_codes: string[];
  }; urgency_reasons_vi: string[];
};
type Engagement = EngagementItem;
type OverviewCampaign = {
  id: string; name: string; status: string; center: { lat: number; lng: number } | null; radius_m: number | null;
  active_coordinators: Array<{ user_id: string; display_name: string | null; started_at: string; last_active_at: string }>;
  request_counts: Record<string, number>; active_claim_count: number; overdue_count: number; has_active_coordinator: boolean;
};
type Summary = HistorySummaryData;
type Overview = { items: OverviewCampaign[]; common_queue?: { unmatched: number; conflict: number } };

const reasonLabel: Record<string, string> = {
  P1_UNHANDLED: 'Có SOS P1 chưa được xử lý', P2_UNHANDLED: 'Có SOS P2 chưa được xử lý',
  P3_UNHANDLED: 'Có SOS P3 chưa được xử lý', P4_UNHANDLED: 'Có SOS P4 chưa được xử lý',
  OVERDUE: 'Có SOS quá hạn', LONG_WAIT: 'Có SOS chờ lâu',
  NO_COORDINATOR: 'Chưa có điều phối viên tham gia', ROUTINE: 'Không có dấu hiệu gấp nổi bật',
};
export function CampaignCoordination({ user, initialRequestId = '' }: { user: Me; initialRequestId?: string }) {
  const primary = user.grants.some((grant) => grant.role_code === 'COORDINATOR' && grant.scope_type === 'SYSTEM');
  const opensSos = Boolean(initialRequestId) || Boolean(new URL(window.location.href).searchParams.get('sos_id'));
  // Primary: campaigns (map + list) · SOS queue · coordination workspace · history. Others: workspace · history.
  const [tab, setTab] = useState(primary ? (opensSos ? 'sos' : 'campaigns') : 'workspace');
  const [triage, setTriage] = useState<TriageCampaign[]>([]);
  const [overview, setOverview] = useState<OverviewCampaign[]>([]);
  const [commonQueue, setCommonQueue] = useState({ unmatched: 0, conflict: 0 });
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [historyId, setHistoryId] = useState('');
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [myHistory, setMyHistory] = useState<Engagement[]>([]);
  const [cursor, setCursor] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [queueRevision, setQueueRevision] = useState(0);
  const selectedEngagement = engagements.find((item) => item.campaign_id === selectedId) ?? engagements[0];
  const overviewCampaigns = overview;

  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    // The primary coordinator controls campaigns but can also engage and work campaigns like any other coordinator.
    const load = Promise.all([
      primary ? api<Overview>('response', '/campaigns/overview') : Promise.resolve(null),
      api<{ items: Engagement[] }>('response', '/me/engagements'),
      api<{ items: TriageCampaign[] }>('response', '/campaigns/triage'),
    ]).then(([overviewValue, mine, ranked]) => {
      if (!live) return;
      if (overviewValue) { setOverview(overviewValue.items); setCommonQueue(overviewValue.common_queue ?? { unmatched: 0, conflict: 0 }); }
      setEngagements(mine.items); setTriage(ranked.items);
      setSelectedId((current) => mine.items.some((item) => item.campaign_id === current) ? current : mine.items[0]?.campaign_id ?? '');
      if (primary) return;
      if (mine.items.length) setTab((current) => current === 'choose' || current === 'my-history' ? current : 'workspace');
      if (!mine.items.length) setTab((current) => current === 'workspace' ? 'choose' : current);
    });
    void load.catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu điều phối.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [primary, refresh]);

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
      setTab(remaining.length ? 'workspace' : 'choose'); setRefresh((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể dừng điều phối chiến dịch.'); }
    finally { setLoading(false); }
  }
  async function showHistory(campaignId: string) {
    if (!campaignId) return;
    setHistoryId(campaignId); setHistory([]); setSummary(null); setCursor(''); setError(''); setTab('history');
    try {
      const [timeline, totals] = await Promise.all([
        api<{ items: HistoryItem[]; cursor?: string }>('response', `/campaigns/${campaignId}/history?limit=50`),
        api<Summary>('response', `/campaigns/${campaignId}/history/summary`),
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
  async function showMyHistory() {
    setError(''); setTab('my-history');
    try { setMyHistory((await api<{ items: Engagement[] }>('response', '/me/coordination-history')).items); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể tải lịch sử điều phối của bạn.'); }
  }

  const tabs = primary
    ? [['campaigns', 'Chiến dịch'], ['sos', 'Xử lý SOS'], ['workspace', 'Không gian điều phối'], ['history', 'Lịch sử']]
    : [['workspace', 'Không gian chiến dịch'], ['my-history', 'Lịch sử của tôi']];
  const activeTab = (id: string) => tab === id || (id === 'workspace' && tab === 'choose') || (id === 'history' && tab === 'my-history');
  return <section className="campaign-coordination">
    <div className="tabs" role="tablist" aria-label="Điều phối chiến dịch">
      {tabs.map(([id, title]) => <button key={id} type="button" role="tab" aria-selected={activeTab(id)} className={activeTab(id) ? 'active' : ''}
        onClick={() => id === 'my-history' ? void showMyHistory() : setTab(id)}>{title}</button>)}
    </div>
    {error && <p role="alert" className="notice error">{error}</p>}
    {loading && <p role="status">Đang cập nhật dữ liệu điều phối…</p>}
    {primary && tab === 'campaigns' && <>
      {(commonQueue.conflict > 0 || commonQueue.unmatched > 0) && <p className="notice warning">
        {commonQueue.unmatched} SOS ngoài mọi vùng · {commonQueue.conflict} SOS trùng nhiều vùng.{' '}
        <button type="button" className="button secondary" onClick={() => setTab('sos')}>Xem trong Xử lý SOS</button>
      </p>}
      <CommonQueueSuggestions onChanged={() => { setQueueRevision((value) => value + 1); setRefresh((value) => value + 1); }} />
      {overviewCampaigns.length > 0 && <div className="operations-table-scroll" role="region" aria-label="Tình hình các chiến dịch" tabIndex={0}>
        <table className="operations-record-table">
          <thead><tr><th scope="col">Chiến dịch</th><th scope="col">SOS đang mở</th><th scope="col">Điều phối viên</th><th scope="col">Cần chú ý</th><th scope="col"><span className="sr-only">Lịch sử</span></th></tr></thead>
          <tbody>{overviewCampaigns.map((campaign) => {
            const open = Object.entries(campaign.request_counts).filter(([status]) => !['RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED', 'DUPLICATE'].includes(status)).reduce((sum, [, count]) => sum + count, 0);
            return <tr key={campaign.id}>
              <th scope="row">{campaign.name}</th>
              <td>{open}</td>
              <td>{campaign.active_coordinators.length}</td>
              <td>{!campaign.has_active_coordinator ? 'Chưa có ai điều phối' : campaign.overdue_count > 0 ? `${campaign.overdue_count} SOS quá hạn` : '—'}</td>
              <td><button className="button secondary" type="button" onClick={() => void showHistory(campaign.id)}>Lịch sử</button></td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
      <details className="sos-fold" open>
        <summary>Danh sách và vòng đời chiến dịch (kích hoạt, tạm dừng, kết thúc)</summary>
        <Campaigns canManage />
      </details>
    </>}
    {primary && tab === 'sos' && <Coordinator key={`sos-${queueRevision}-${initialRequestId}`} page="queue" currentUserId={user.id} canSeeUnassigned initialRequestId={initialRequestId} />}
    {primary && tab === 'history' && <>
      <p><button className="button secondary" type="button" onClick={() => void showMyHistory()}>Xem lịch sử điều phối của tôi</button></p>
      <label>Chiến dịch <select value={historyId} onChange={(event) => void showHistory(event.target.value)}>
        <option value="">Chọn chiến dịch</option>{overviewCampaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <HistorySummary summary={summary} />
      <Timeline items={history} />
      {cursor && <button className="button secondary" type="button" onClick={() => void loadMoreHistory()}>Tải các sự kiện cũ hơn</button>}
    </>}
    {tab === 'choose' && <section aria-label="Chọn chiến dịch cần điều phối" className="record-list">
      <h2>Chọn chiến dịch cần điều phối</h2><p>Các chiến dịch đang hoạt động được xếp theo số liệu SOS, thời gian chờ và số điều phối viên.</p>
      {triage.map((campaign, index) => <article className="card" key={campaign.id}>
        <div className="section-header"><div><span className="eyebrow">{index === 0 ? 'Gấp nhất hiện tại' : `Mức gấp ${index + 1}`}</span><h3>{campaign.name}</h3></div>
          <strong>{campaign.urgency.active_coordinator_count} điều phối viên đang tham gia</strong></div>
        <p>{campaign.urgency_reasons_vi.join(' · ') || campaign.urgency.reason_codes.map((code) => reasonLabel[code] ?? 'Cần theo dõi').join(' · ')}</p>
        <p>SOS gấp nhất: {campaign.urgency.highest_priority ?? 'Không có'} · {campaign.urgency.highest_priority_unhandled_count} chưa xử lý · {campaign.urgency.overdue_count} quá hạn.</p>
        <button className="button primary" type="button" disabled={loading || engagements.some((item) => item.campaign_id === campaign.id)} onClick={() => void engage(campaign.id)}>
          {engagements.some((item) => item.campaign_id === campaign.id) ? 'Đang điều phối' : 'Bắt đầu điều phối'}
        </button>
      </article>)}
      {!loading && !triage.length && <p className="empty">Hiện không có chiến dịch đang hoạt động.</p>}
    </section>}
    {tab === 'workspace' && <>
      {engagements.length > 0 ? <div className="card campaign-engagement-toolbar">
        <label>Chiến dịch đang điều phối <select value={selectedEngagement?.campaign_id ?? ''} onChange={(event) => setSelectedId(event.target.value)}>
          {engagements.map((item) => <option key={item.id} value={item.campaign_id}>{item.campaign_name ?? item.campaign_id}</option>)}
        </select></label>
        <button className="button secondary" type="button" onClick={() => setTab('choose')}>Chọn thêm chiến dịch gấp</button>
        {selectedEngagement && <button className="button secondary" type="button" disabled={loading} onClick={() => void disengage(selectedEngagement.campaign_id)}>Dừng điều phối</button>}
      </div> : <div className="empty">Bạn chưa tham gia điều phối chiến dịch nào. Hãy chọn chiến dịch gấp.</div>}
      {selectedEngagement && <Coordinator key={selectedEngagement.campaign_id} page="queue" currentUserId={user.id} campaignId={selectedEngagement.campaign_id} />}
    </>}
    {tab === 'my-history' && <>
      {primary && <p><button className="button secondary" type="button" onClick={() => setTab('history')}>← Lịch sử theo chiến dịch</button></p>}
      <MyHistory items={myHistory} />
    </>}
  </section>;
}
