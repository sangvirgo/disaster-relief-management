import { Dropdown } from '../../components/ui/Dropdown';
import { useEffect, useState } from 'react';
import { api, newCommandKey } from '../../api/client';
import { useUrlView } from '../../app/useUrlView';
import type { Me } from '../../auth/session';
import { StatusBadge } from '../../components/StatusBadge';
import { Pager } from '../../components/ui/Pager';
import { Coordinator } from './Coordinator';
import { Campaigns } from './Campaigns';
import { CommonQueueSuggestions } from './CommonQueueSuggestions';
import { ScopedCampaignMap } from './ScopedCampaignMap';
import { HistorySummary, MyHistory, Timeline, type EngagementItem, type HistoryItem, type HistorySummaryData } from './CampaignHistory';
import './campaign-coordination.css';

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
const OVERVIEW_PAGE_SIZE = 10;
const campaignTabs = ['campaigns', 'routing', 'sos', 'workspace', 'history', 'choose', 'my-history'] as const;

const reasonLabel: Record<string, string> = {
  P1_UNHANDLED: 'Có SOS P1 chưa được xử lý', P2_UNHANDLED: 'Có SOS P2 chưa được xử lý',
  P3_UNHANDLED: 'Có SOS P3 chưa được xử lý', P4_UNHANDLED: 'Có SOS P4 chưa được xử lý',
  OVERDUE: 'Có SOS quá hạn', LONG_WAIT: 'Có SOS chờ lâu',
  NO_COORDINATOR: 'Chưa có điều phối viên tham gia', ROUTINE: 'Không có dấu hiệu gấp nổi bật',
};
export function CampaignCoordination({ user, initialRequestId = '' }: { user: Me; initialRequestId?: string }) {
  const opensSos = Boolean(initialRequestId) || Boolean(new URL(window.location.href).searchParams.get('sos_id'));
  // Tabs: SOS routing (default, map) · campaigns (overview + list) · SOS queue · coordination workspace · history.
  const [tab, setTab] = useUrlView('campaign_tab', campaignTabs, opensSos ? 'sos' : 'routing');
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
  const [managementOpen, setManagementOpen] = useState(false);
  const [overviewPage, setOverviewPage] = useState(0);
  const selectedEngagement = engagements.find((item) => item.campaign_id === selectedId) ?? engagements[0];
  const overviewCampaigns = overview;
  const activeCampaignCount = overviewCampaigns.filter((item) => item.status === 'ACTIVE').length;
  const openRequestCount = overviewCampaigns.reduce((total, campaign) => total + Object.entries(campaign.request_counts ?? {})
    .filter(([status]) => !['RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED', 'DUPLICATE'].includes(status))
    .reduce((count, [, value]) => count + value, 0), 0);
  const unassignedRequestCount = commonQueue.unmatched + commonQueue.conflict;
  const overviewPageCount = Math.max(1, Math.ceil(overviewCampaigns.length / OVERVIEW_PAGE_SIZE));
  const currentOverviewPage = Math.min(overviewPage, overviewPageCount - 1);
  const visibleCampaigns = overviewCampaigns.slice(currentOverviewPage * OVERVIEW_PAGE_SIZE, (currentOverviewPage + 1) * OVERVIEW_PAGE_SIZE);

  useEffect(() => {
    setOverviewPage((page) => Math.min(page, Math.max(0, Math.ceil(overviewCampaigns.length / OVERVIEW_PAGE_SIZE) - 1)));
  }, [overviewCampaigns.length]);

  useEffect(() => {
    let live = true;
    setLoading(true); setError('');
    // A coordinator controls campaigns and can also engage and work them.
    const load = Promise.all([
      api<Overview>('response', '/campaigns/overview'),
      api<{ items: Engagement[] }>('response', '/me/engagements'),
      api<{ items: TriageCampaign[] }>('response', '/campaigns/triage'),
    ]).then(([overviewValue, mine, ranked]) => {
      if (!live) return;
      setOverview(overviewValue.items); setCommonQueue(overviewValue.common_queue ?? { unmatched: 0, conflict: 0 });
      setEngagements(mine.items); setTriage(ranked.items);
      setSelectedId((current) => mine.items.some((item) => item.campaign_id === current) ? current : mine.items[0]?.campaign_id ?? '');
    });
    void load.catch((cause: unknown) => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu điều phối.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [refresh]);

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

  // A coordinator with only campaign-scoped grants works their assigned campaigns and never handles unassigned/conflict SOS.
  const isScopedCoordinator = !user.grants.some((grant) => grant.scope_type === 'SYSTEM' && (grant.role_code === 'COORDINATOR' || grant.role_code === 'ADMIN'))
    && user.grants.some((grant) => grant.role_code === 'COORDINATOR' && grant.scope_type === 'CAMPAIGN');
  const scopedCampaignIds = [...new Set([
    ...user.grants.filter((grant) => grant.role_code === 'COORDINATOR' && grant.scope_type === 'CAMPAIGN' && grant.campaign_id).map((grant) => grant.campaign_id!),
    ...engagements.map((item) => item.campaign_id),
  ])];
  const tabs = [['routing', isScopedCoordinator ? 'Bản đồ chiến dịch' : 'Phân vùng SOS'], ['campaigns', 'Chiến dịch'], ['sos', 'Xử lý SOS'], ['workspace', 'Không gian điều phối'], ['history', 'Lịch sử']];
  const activeTab = (id: string) => tab === id || (id === 'workspace' && tab === 'choose') || (id === 'history' && tab === 'my-history');
  return <section className="campaign-coordination">
    <div className="tabs" role="tablist" aria-label="Điều phối chiến dịch">
      {tabs.map(([id, title]) => <button key={id} type="button" role="tab" aria-selected={activeTab(id)} className={activeTab(id) ? 'active' : ''}
        onClick={() => id === 'my-history' ? void showMyHistory() : setTab(id as typeof campaignTabs[number])}>{title}</button>)}
    </div>
    {error && <p role="alert" className="notice error">{error}</p>}
    {loading && <p role="status">Đang cập nhật dữ liệu điều phối…</p>}
    {tab === 'campaigns' && <>
      <div className="campaign-overview">
        <div className="campaign-overview__metrics" aria-label="Tóm tắt chiến dịch">
          <article className="campaign-overview__metric">
            <span className="campaign-overview__metric-label">Chiến dịch hoạt động</span>
            <strong>{loading && overviewCampaigns.length === 0 ? '—' : activeCampaignCount}</strong>
            <span className="campaign-overview__metric-note">đang tiếp nhận và điều phối</span>
          </article>
          <article className="campaign-overview__metric campaign-overview__metric--blue">
            <span className="campaign-overview__metric-label">SOS đang mở</span>
            <strong>{loading && overviewCampaigns.length === 0 ? '—' : openRequestCount}</strong>
            <span className="campaign-overview__metric-note">trên các chiến dịch</span>
          </article>
          {!isScopedCoordinator && <button type="button" className="campaign-overview__metric campaign-overview__metric--attention"
            aria-label={`Mở tab Phân vùng SOS, ${unassignedRequestCount} SOS cần phân vùng`} onClick={() => setTab('routing')}>
            <span className="campaign-overview__metric-label">SOS cần phân vùng</span>
            <strong>{loading && overviewCampaigns.length === 0 ? '—' : unassignedRequestCount}</strong>
            <span className="campaign-overview__metric-note">
              {loading && overviewCampaigns.length === 0 ? 'Đang tải dữ liệu…' : `${commonQueue.unmatched} ngoài vùng · ${commonQueue.conflict} trùng vùng`}
              <span className="campaign-overview__metric-link">Mở tab Phân vùng SOS <span aria-hidden="true">→</span></span>
            </span>
          </button>}
        </div>

        <section className="campaign-overview__list" aria-labelledby="campaign-overview-title">
          <header className="campaign-overview__header">
            <div>
              <span className="eyebrow">Tổng quan vận hành</span>
              <h2 id="campaign-overview-title">Chiến dịch đang theo dõi</h2>
            </div>
            <div className="campaign-overview__header-actions">
              <span className="campaign-overview__count">{overviewCampaigns.length} chiến dịch</span>
              <button type="button" className="button secondary refresh-action" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>Làm mới</button>
              <button type="button" className="button secondary" aria-expanded={managementOpen} aria-controls="campaign-management-panel"
                onClick={() => setManagementOpen((value) => !value)}>{managementOpen ? 'Ẩn quản lý' : 'Quản lý chiến dịch'}</button>
            </div>
          </header>

          {overviewCampaigns.length > 0 ? <div className="campaign-overview__table-scroll" role="region" aria-label="Tình hình các chiến dịch" tabIndex={0}>
            <table className="campaign-overview__table">
              <thead><tr><th scope="col">Chiến dịch</th><th scope="col">SOS mở</th><th scope="col">Cần lưu ý</th><th scope="col"><span className="sr-only">Lịch sử</span></th></tr></thead>
              <tbody>{visibleCampaigns.map((campaign) => {
                const open = Object.entries(campaign.request_counts ?? {}).filter(([status]) => !['RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED', 'DUPLICATE'].includes(status))
                  .reduce((sum, [, count]) => sum + count, 0);
                return <tr key={campaign.id}>
                  <th scope="row" data-label="Chiến dịch">
                    <span className="campaign-overview__campaign-name">{campaign.name}<StatusBadge status={campaign.status} /></span>
                    <small>{campaign.active_coordinators.length} điều phối viên đang tham gia</small>
                  </th>
                  <td data-label="SOS mở"><strong>{open}</strong></td>
                  <td data-label="Cần lưu ý">
                    {!campaign.has_active_coordinator ? <span className="campaign-overview__attention">Chưa có điều phối viên</span>
                      : campaign.overdue_count > 0 ? <span className="campaign-overview__attention">{campaign.overdue_count} SOS quá hạn</span>
                        : <span className="campaign-overview__quiet">Đang theo dõi</span>}
                  </td>
                  <td data-label="Lịch sử"><button className="button secondary campaign-overview__history" type="button" onClick={() => void showHistory(campaign.id)}>Lịch sử</button></td>
                </tr>;
              })}</tbody>
            </table>
          </div> : !loading && <p className="empty campaign-overview__empty">Chưa có chiến dịch trong phạm vi được cấp quyền.</p>}

          <Pager page={currentOverviewPage} hasNext={currentOverviewPage < overviewPageCount - 1} loading={loading}
            onPrev={() => setOverviewPage((page) => Math.max(0, page - 1))}
            onNext={() => setOverviewPage((page) => Math.min(overviewPageCount - 1, page + 1))}
            count={visibleCampaigns.length} noun="chiến dịch" />

          <div id="campaign-management-panel" className="campaign-overview__expanded" hidden={!managementOpen}>
            {managementOpen && <Campaigns canManage canSetup />}
          </div>
        </section>
      </div>
    </>}
    {tab === 'routing' && isScopedCoordinator && <ScopedCampaignMap campaigns={overviewCampaigns} campaignIds={scopedCampaignIds} />}
    {tab === 'routing' && !isScopedCoordinator && <CommonQueueSuggestions onChanged={() => { setQueueRevision((value) => value + 1); setRefresh((value) => value + 1); }} />}
    {tab === 'sos' && <Coordinator key={`sos-${queueRevision}-${initialRequestId}`} page="queue" currentUserId={user.id} user={user} canSeeUnassigned={!isScopedCoordinator} initialRequestId={initialRequestId} />}
    {tab === 'history' && <>
      <p><button className="button secondary" type="button" onClick={() => void showMyHistory()}>Xem lịch sử điều phối của tôi</button></p>
      <label className="campaign-history-select">Chiến dịch <Dropdown value={historyId} onChange={(event) => void showHistory(event.target.value)}>
        <option value="">Chọn chiến dịch</option>{overviewCampaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </Dropdown></label>
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
        <label className="campaign-engagement-toolbar__select">Chiến dịch đang điều phối <Dropdown value={selectedEngagement?.campaign_id ?? ''} onChange={(event) => setSelectedId(event.target.value)}>
          {engagements.map((item) => <option key={item.id} value={item.campaign_id}>{item.campaign_name ?? item.campaign_id}</option>)}
        </Dropdown></label>
        <div className="campaign-engagement-toolbar__actions">
          <button className="button secondary" type="button" onClick={() => setTab('choose')}>Chọn thêm chiến dịch gấp</button>
          {selectedEngagement && <button className="button secondary" type="button" disabled={loading} onClick={() => void disengage(selectedEngagement.campaign_id)}>Dừng điều phối</button>}
        </div>
      </div> : <div className="empty">Bạn chưa tham gia điều phối chiến dịch nào. Hãy chọn chiến dịch gấp.</div>}
      {selectedEngagement && <Coordinator key={selectedEngagement.campaign_id} page="queue" currentUserId={user.id} user={user} campaignId={selectedEngagement.campaign_id} />}
    </>}
    {tab === 'my-history' && <>
      <p><button className="button secondary" type="button" onClick={() => setTab('history')}>← Lịch sử theo chiến dịch</button></p>
      <MyHistory items={myHistory} />
    </>}
  </section>;
}
