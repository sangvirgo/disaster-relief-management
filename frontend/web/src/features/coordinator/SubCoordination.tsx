import { useEffect, useRef, useState } from 'react';
import { api, ApiError, newCommandKey } from '../../api/client';
import { useUrlView } from '../../app/useUrlView';
import type { Me } from '../../auth/session';
import { Dropdown } from '../../components/ui/Dropdown';
import { EmptyState } from '../../components/ui/EmptyState';
import { confirmAction } from '../../components/confirmAction';
import { Coordinator } from './Coordinator';
import { CampaignHotspots, type HotspotOverview, type HotspotTriage } from './CampaignHotspots';
import { CampaignHistoryTab, type EngagementItem } from './CampaignHistory';
import { engagementUrl } from './subCoordinationNavigation';
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
  const changeTabRef = useRef(setTab);
  changeTabRef.current = setTab;
  const [triage, setTriage] = useState<HotspotTriage[]>([]);
  const [overview, setOverview] = useState<HotspotOverview[]>([]);
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [selectedId, setSelectedId] = useState(() => new URL(window.location.href).searchParams.get('engagement_id') || '');
  const [activeRequestId, setActiveRequestId] = useState(initialRequestId);
  const [entryRequestId] = useState(() => initialRequestId || new URL(window.location.href).searchParams.get('sos_id') || '');
  const [entryScopeResolved, setEntryScopeResolved] = useState(!entryRequestId);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [historyId, setHistoryId] = useState('');
  const [myHistory, setMyHistory] = useState<Engagement[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const engagedIds = engagements.map((item) => item.campaign_id);
  const selected = engagements.find((item) => item.campaign_id === selectedId) ?? engagements[0];
  const selectedMinutesLeft = selected ? minutesLeft(selected) : null;
  useEffect(() => { setActiveRequestId(initialRequestId); }, [initialRequestId]);

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

  // Notification/deep links may refer to a different engaged campaign than the saved picker.
  // Read through the scoped API; never infer access or auto-engage a campaign from a link.
  useEffect(() => {
    if (!loaded || entryScopeResolved || !entryRequestId) return;
    let live = true;
    api<{ campaign_id?: string | null }>('response', `/requests/${encodeURIComponent(entryRequestId)}`)
      .then(request => {
        if (!live) return;
        if (!request.campaign_id || !engagements.some(item => item.campaign_id === request.campaign_id))
          throw new Error('SOS này không thuộc chiến dịch bạn đang điều phối. Hãy chọn chiến dịch phù hợp trước khi mở lại hồ sơ.');
        setSelectedId(request.campaign_id);
        const url = new URL(window.location.href);
        url.searchParams.set('engagement_id', request.campaign_id);
        window.history.replaceState(null, '', url);
      })
      .catch(cause => {
        if (!live) return;
        setError(cause instanceof ApiError && cause.code === 'FORBIDDEN'
          ? 'SOS nằm ngoài chiến dịch bạn đang nhận hoặc phiên điều phối đã hết hạn. Chọn chiến dịch phù hợp rồi mở lại thông báo.'
          : cause instanceof Error ? cause.message : 'Không mở được SOS trong phạm vi điều phối hiện tại.');
        if (cause instanceof ApiError && cause.code === 'FORBIDDEN') changeTabRef.current('routing');
        setActiveRequestId('');
        const url = new URL(window.location.href);
        url.searchParams.delete('sos_id'); url.searchParams.delete('sos_tab');
        window.history.replaceState(null, '', url);
      })
      .finally(() => { if (live) setEntryScopeResolved(true); });
    return () => { live = false; };
  }, [loaded, entryScopeResolved, entryRequestId, engagements]);

  // Refresh session state as well as the map; this does not issue a new engage command.
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') setRefresh((value) => value + 1); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

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
      const mine = await api<{ items: Engagement[] }>('response', '/me/engagements');
      setEngagements(mine.items);
      selectCampaign(campaignId); setTab('workspace'); setRefresh((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể bắt đầu điều phối chiến dịch.'); }
    finally { setLoading(false); }
  }
  async function disengage(campaignId: string) {
    if (!await confirmAction('Dừng điều phối chiến dịch này? Bạn có thể nhận lại từ màn chọn chiến dịch.')) return;
    setLoading(true); setError('');
    try {
      await api('response', `/campaigns/${campaignId}/disengage`, { method: 'POST', idempotencyKey: newCommandKey() });
      const remaining = engagements.filter((item) => item.campaign_id !== campaignId);
      setEngagements(remaining); selectCampaign(remaining[0]?.campaign_id ?? '');
      if (!remaining.length) setTab('routing');
      setRefresh((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Không thể dừng điều phối chiến dịch.'); }
    finally { setLoading(false); }
  }
  function open(campaignId: string) {
    selectCampaign(campaignId); setTab('workspace');
  }
  function selectCampaign(campaignId: string) {
    const url = engagementUrl(window.location.href, campaignId, selected?.campaign_id);
    if (campaignId !== selected?.campaign_id) {
      setActiveRequestId('');
    }
    window.history.replaceState(null, '', url);
    setSelectedId(campaignId);
    setHistoryId(campaignId);
  }
  useEffect(() => {
    if (tab !== 'history' && tab !== 'my-history') return;
    let live = true;
    setHistoryLoading(true); setError('');
    api<{ items: Engagement[] }>('response', '/me/coordination-history')
      .then(value => { if (live) { setMyHistory(value.items); setHistoryLoaded(true); } })
      .catch(cause => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải lịch sử điều phối.'); })
      .finally(() => { if (live) setHistoryLoading(false); });
    return () => { live = false; };
  }, [tab, refresh]);
  const workedCampaigns = [...new Map([...engagements, ...myHistory].map(item => [item.campaign_id, {
    id: item.campaign_id, name: item.campaign_name ?? 'Chiến dịch', status: overview.find(area => area.id === item.campaign_id)?.status ?? '',
  }])).values()];

  const tabTitles: Array<[Tab, string]> = [
    ['routing', 'Chọn chiến dịch'],
    ['workspace', 'Xử lý SOS'],
    ['history', 'Lịch sử'],
  ];
  const isActive = (id: Tab) => tab === id || (id === 'history' && tab === 'my-history');

  return <section className="campaign-coordination sub-coordination">
    <header className="sub-coordination__header"><p>Chọn chiến dịch → Xử lý SOS → Theo dõi kết quả</p><div className="sub-coordination__header-actions"><span className="chip">Đang điều phối {engagements.length}/3</span><button type="button" className="button secondary refresh-action" disabled={loading || historyLoading} onClick={() => setRefresh(value => value + 1)}>Làm mới</button></div></header>

    {engagements.length > 0 && tab === 'routing' && <div className="sub-coordination__continue" role="group" aria-label="Chiến dịch bạn đang điều phối">
      <span>Tiếp tục:</span>
      {engagements.map(item => <button type="button" className="hotspots__chip" key={item.id} onClick={() => open(item.campaign_id)}>{item.campaign_name ?? 'Chiến dịch'} <span aria-hidden="true">→</span></button>)}
    </div>}

    <div className="tabs" role="tablist" aria-label="Điều phối chiến dịch">
      {tabTitles.map(([id, title]) => <button key={id} type="button" role="tab" aria-selected={isActive(id)} className={isActive(id) ? 'active' : ''}
        onClick={() => setTab(id)}>{title}</button>)}
    </div>
    {error && <div role="alert" className="notice error"><p>{error}</p><button type="button" className="button secondary" disabled={loading || historyLoading} onClick={() => setRefresh(value => value + 1)}>Thử lại</button></div>}

    {tab === 'routing' && <CampaignHotspots triage={triage} overview={overview} engagedIds={engagedIds} loading={loading} showRefresh={false}
      onEngage={(id) => void engage(id)} onOpen={open} onRefresh={() => setRefresh((value) => value + 1)} />}

    {tab === 'workspace' && (!loaded || !entryScopeResolved ? <p role="status">Đang kiểm tra phạm vi chiến dịch…</p> : selected
      ? <>
        <div className="sub-coordination__workspace-head"><div><span className="eyebrow">Chiến dịch đang xử lý</span>{engagements.length > 1 ? <Dropdown value={selected.campaign_id} aria-label="Chọn chiến dịch để xử lý" onChange={event => selectCampaign(event.target.value)}>{engagements.map(item => <option key={item.id} value={item.campaign_id}>{item.campaign_name ?? 'Chiến dịch'}</option>)}</Dropdown> : <strong>{selected.campaign_name ?? 'Chiến dịch'}</strong>}</div><div className="sub-coordination__header-actions">{selectedMinutesLeft != null && <span className={`chip${selectedMinutesLeft <= 10 ? ' chip--warn' : ''}`}>Phiên còn {selectedMinutesLeft} phút</span>}<button type="button" className="button secondary small" onClick={() => setTab('routing')}>Đổi chiến dịch</button><button type="button" className="button secondary small" disabled={loading} onClick={() => void disengage(selected.campaign_id)}>Dừng điều phối</button></div></div>
        <Coordinator key={selected.campaign_id} page="queue" currentUserId={user.id} user={user} campaignId={selected.campaign_id}
          initialRequestId={activeRequestId} onRequestClosed={() => setActiveRequestId('')} />
      </>
      : loading ? <p role="status">Đang kiểm tra chiến dịch của bạn…</p> : <EmptyState title="Bạn chưa nhận chiến dịch nào"
        description="Mở bản đồ điểm nóng để xem chiến dịch nào đang có nhiều SOS gấp, rồi bấm “Nhận điều phối và xử lý”."
        action={<button type="button" className="button primary" onClick={() => setTab('routing')}>Mở bản đồ điểm nóng</button>} />)}

    {(tab === 'history' || tab === 'my-history') && <>
      {historyLoading && <p role="status">Đang tải lịch sử điều phối…</p>}
      {historyLoaded && <CampaignHistoryTab campaigns={workedCampaigns} campaignId={historyId} preferredIds={selected ? [selected.campaign_id, ...engagedIds] : engagedIds} onCampaignChange={setHistoryId} initialMode={tab === 'my-history' ? 'mine' : 'campaign'} />}
    </>}
  </section>;
}
