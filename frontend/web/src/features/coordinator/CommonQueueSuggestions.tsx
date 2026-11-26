import { Dropdown } from '../../components/ui/Dropdown';
import { useEffect, useMemo, useState } from 'react';
import { api, newCommandKey } from '../../api/client';
import { useCursorNav } from '../../api/useCursorNav';
import { Pager } from '../../components/ui/Pager';
import { CampaignAreaMap } from '../../maps/CampaignAreaMap';

type LatLng = { latitude: number; longitude: number };
type NearestCampaign = {
  id: string; name: string; status: string; version: number; radius_m: number;
  distance_m: number; inside_area: boolean; suggested_radius_m: number;
};
type SuggestionRequest = {
  id: string;
  tracking_code: string;
  priority: string | null;
  status: string;
  version: number;
  campaign_match_state: string;
  location: LatLng;
  received_at: string;
  candidate_campaign_ids: string[];
  needs_relief_supplies?: boolean;
  nearest_campaign: NearestCampaign | null;
};
type MapPoint = {
  id: string; tracking_code: string; priority: string | null; campaign_match_state: string; location: LatLng;
};
type SuggestionCluster = {
  id: string; request_ids: string[]; count: number; center: LatLng; suggested_radius_m: number; highest_priority: string | null;
};
type SuggestionCampaign = {
  id: string; name: string; status: string; version: number; center: { lat: number; lng: number }; radius_m: number;
};
type Suggestions = {
  requests: SuggestionRequest[];
  total: number;
  supply_need_total?: number;
  more: boolean;
  cursor?: string;
  map_points: MapPoint[];
  clusters: SuggestionCluster[];
  campaigns: SuggestionCampaign[];
  attach_targets: { id: string; name: string }[];
};
type MatchFilter = '' | 'UNMATCHED' | 'CONFLICT';

const PAGE_SIZE = 8;
// Area used when a SOS is outside every campaign and there is no nearby campaign to extend.
const NEW_CAMPAIGN_RADIUS_M = 3_000;
const MAX_RADIUS_M = 300_000;
const API_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STATE_VI: Record<string, string> = { UNMATCHED: 'Ngoài mọi vùng', CONFLICT: 'Trùng nhiều vùng' };
const FILTERS: Array<[MatchFilter, string]> = [['', 'Tất cả'], ['UNMATCHED', 'Ngoài mọi vùng'], ['CONFLICT', 'Trùng nhiều vùng']];

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : 'Chưa thực hiện được thao tác. Hãy thử lại.');
function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (value: number) => value * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
const km = (meters: number) => (meters / 1000).toFixed(1).replace('.', ',');
const post = <T,>(path: string, body: unknown) =>
  api<T>('response', path, { method: 'POST', body, idempotencyKey: newCommandKey() });

/**
 * Control panel for the primary coordinator. Draw or adjust campaign areas on the map, and decide for each SOS that has no
 * campaign (outside every area, or inside several) whether to attach it to a campaign or start a new one.
 */
export function CommonQueueSuggestions({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<Suggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [highlight, setHighlight] = useState('');
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [campaignRequests, setCampaignRequests] = useState<MapPoint[]>([]);
  const [attachedPoints, setAttachedPoints] = useState<MapPoint[]>([]);
  const [filter, setFilter] = useState<MatchFilter>('');
  const [cursor, setCursor, prevPage, pageIndex] = useCursorNav<string>('');
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [mapFocus, setMapFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [areaExpansion, setAreaExpansion] = useState<{
    id: string; name: string; center: { lat: number; lng: number }; fromRadiusM: number; toRadiusM: number; attachedCount: number; nonce: number;
  } | null>(null);
  // Map editor: draw a new campaign area, or adjust an existing one (kind 'adjust' carries the campaign id).
  const [editMode, setEditMode] = useState<{ kind: 'create' } | { kind: 'adjust'; id: string } | null>(null);
  const [draftCenter, setDraftCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [draftRadius, setDraftRadius] = useState(NEW_CAMPAIGN_RADIUS_M);
  const [draftName, setDraftName] = useState('');
  const [pendingAdjustment, setPendingAdjustment] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (filter) params.set('match_state', filter);
    if (cursor) params.set('cursor', cursor);
    api<Suggestions>('response', `/campaigns/common-queue/suggestions?${params}`)
      .then((value) => { if (live) setData(value); })
      .catch((cause) => { if (live) setError(messageOf(cause)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [revision, filter, cursor]);

  // Open SOS already attached to a campaign (blue dots on the overview map).
  useEffect(() => {
    let live = true;
    const load = async () => {
      const points: MapPoint[] = [];
      for (const state of ['AUTO_ATTACHED', 'MANUAL']) {
        let next = '';
        let pages = 0;
        do {
          const params = new URLSearchParams({ campaign_match_state: state, limit: '100' });
          if (next) params.set('cursor', next);
          const page = await api<{ items: Array<{ id: string; tracking_code: string; status: string; priority: string | null;
            campaign_id?: string | null; approx_location?: { latitude: number; longitude: number } | null }>; more: boolean; cursor?: string }>('response', `/requests?${params}`);
          points.push(...page.items.filter((item) => item.campaign_id && item.approx_location
            && !['RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED', 'DUPLICATE'].includes(item.status)).map((item) => ({
            id: item.id, tracking_code: item.tracking_code, priority: item.priority, campaign_match_state: 'CAMPAIGN', location: item.approx_location!,
          })));
          next = page.more ? page.cursor ?? '' : '';
          pages += 1;
        } while (next && pages < 5);
      }
      if (live) setAttachedPoints(points);
    };
    void load().catch(() => { if (live) setAttachedPoints([]); });
    return () => { live = false; };
  }, [revision]);

  useEffect(() => {
    if (!selectedCampaignId) { setCampaignRequests([]); return; }
    let live = true;
    setCampaignRequests([]);
    const load = async () => {
      const points: MapPoint[] = [];
      for (const lane of ['NORMAL', 'RATE_LIMITED_REVIEW', 'PROXY_QUOTA_REVIEW']) {
        let next = '';
        do {
          const params = new URLSearchParams({ campaign_id: selectedCampaignId, review_lane: lane, limit: '100' });
          if (next) params.set('cursor', next);
          const page = await api<{ items: Array<{ id: string; tracking_code: string; status: string; priority: string | null;
            approx_location?: { latitude: number; longitude: number } | null }>; more: boolean; cursor?: string }>('response', `/requests?${params}`);
          points.push(...page.items.filter((item) => !['RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED', 'DUPLICATE'].includes(item.status)
            && item.approx_location).map((item) => ({ id: item.id, tracking_code: item.tracking_code,
            priority: item.priority, campaign_match_state: 'CAMPAIGN', location: item.approx_location! })));
          next = page.more ? page.cursor ?? '' : '';
        } while (next && points.length < 1000);
      }
      if (live) setCampaignRequests(points);
    };
    void load().catch((cause) => { if (live) setError(messageOf(cause)); });
    return () => { live = false; };
  }, [selectedCampaignId, revision]);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      setCursor('');
      onChanged();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
      setRevision((value) => value + 1);
    }
  }

  const attachTargets = data?.attach_targets ?? [];
  const attach = (item: SuggestionRequest, campaignId: string) => run(
    () => post(`/requests/${item.id}/attach-campaign`, { campaign_id: campaignId, expected_version: item.version }).then(() => undefined),
    `Đã gắn ${item.tracking_code} vào chiến dịch.`,
  );
  async function expandArea(campaign: SuggestionCampaign, radiusM: number) {
    setBusy(true);
    setError('');
    setMessage('');
    setSelectedCampaignId(campaign.id);
    document.querySelector('.common-queue-suggestions .campaign-area-map')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try {
      const result = await post<{ attached_request_count?: number }>(`/campaigns/${campaign.id}/area`,
        { expected_version: campaign.version, center: campaign.center, radius_m: radiusM });
      setData(current => current ? {
        ...current,
        campaigns: current.campaigns.map(item => item.id === campaign.id ? { ...item, radius_m: radiusM } : item),
      } : current);
      setAreaExpansion({ id: campaign.id, name: campaign.name, center: campaign.center,
        fromRadiusM: campaign.radius_m, toRadiusM: radiusM, attachedCount: result.attached_request_count ?? 0, nonce: Date.now() });
    } catch (cause) {
      setError(messageOf(cause));
      setBusy(false);
      setRevision(value => value + 1);
    }
  }

  function finishAreaExpansion() {
    if (!areaExpansion) return;
    setAreaExpansion(null);
    const attachedMessage = areaExpansion.attachedCount > 0
      ? `Đã gắn ${areaExpansion.attachedCount} SOS trong vùng mới.`
      : 'Chưa có SOS nào được gắn trong lần mở rộng này.';
    setMessage(`Đã mở rộng vùng ${areaExpansion.name} đến ${km(areaExpansion.toRadiusM)} km. ${attachedMessage}`);
    setCursor('');
    setRevision(value => value + 1);
    onChanged();
    setBusy(false);
  }
  const createAndActivate = (name: string, center: LatLng, radiusM: number, success: string) => run(async () => {
    const created = await post<{ id: string; version: number }>('/campaigns', {
      name, center: { lat: center.latitude, lng: center.longitude }, radius_m: radiusM,
    });
    try {
      await post(`/campaigns/${created.id}/activate`, { expected_version: created.version });
      setSelectedCampaignId(created.id);
    } catch (cause) {
      throw new Error(`Đã tạo chiến dịch "${name}" nhưng chưa kích hoạt được: ${messageOf(cause)} Hãy kích hoạt trong danh sách chiến dịch bên dưới.`);
    }
  }, success);

  function startCreate() {
    setEditMode({ kind: 'create' }); setDraftCenter(null); setDraftRadius(NEW_CAMPAIGN_RADIUS_M); setDraftName('');
    setPendingAdjustment(false);
    setError(''); setMessage('');
  }
  function startAdjust(id: string) {
    const campaign = data?.campaigns.find((item) => item.id === id);
    if (!campaign) { setEditMode(null); return; }
    setSelectedCampaignId(id);
    setEditMode({ kind: 'adjust', id }); setDraftCenter(campaign.center); setDraftRadius(campaign.radius_m);
    setPendingAdjustment(false);
    setError(''); setMessage('');
  }
  function cancelEdit() { setEditMode(null); setDraftCenter(null); setPendingAdjustment(false); setError(''); }
  const draftReady = Boolean(draftCenter) && Number.isInteger(draftRadius) && draftRadius >= 500 && draftRadius <= MAX_RADIUS_M;
  const coveredByDraft = useMemo(() => {
    if (!draftCenter || !data) return 0;
    return data.map_points.filter((item) => haversineM(draftCenter, { lat: item.location.latitude, lng: item.location.longitude }) <= draftRadius).length;
  }, [data, draftCenter, draftRadius]);
  const adjusting = editMode?.kind === 'adjust' ? data?.campaigns.find((item) => item.id === editMode.id) : undefined;
  const invalidCampaignId = Boolean(adjusting && !API_UUID.test(adjusting.id));

  async function createFromDraft(activate: boolean) {
    if (!draftCenter || !draftReady) return;
    const name = draftName.trim().normalize('NFC');
    if (!name) { setError('Hãy đặt tên cho chiến dịch.'); return; }
    await run(async () => {
      const created = await post<{ id: string; version: number }>('/campaigns', { name, center: draftCenter, radius_m: draftRadius });
      if (activate) {
        try { await post(`/campaigns/${created.id}/activate`, { expected_version: created.version }); }
        catch (cause) { throw new Error(`Đã tạo chiến dịch "${name}" nhưng chưa kích hoạt được: ${messageOf(cause)}`); }
      }
      setSelectedCampaignId(created.id);
      cancelEdit();
    }, activate ? `Đã tạo và kích hoạt chiến dịch "${name}".` : `Đã lưu bản nháp "${name}".`);
  }
  async function saveAdjusted() {
    if (!adjusting || !draftCenter || !draftReady || invalidCampaignId) return;
    await run(async () => {
      if (adjusting.status === 'DRAFT') {
        await api('response', `/campaigns/${adjusting.id}`, {
          method: 'PATCH', body: { expected_version: adjusting.version, center: draftCenter, radius_m: draftRadius }, idempotencyKey: newCommandKey(),
        });
      } else {
        await post(`/campaigns/${adjusting.id}/area`, { expected_version: adjusting.version, center: draftCenter, radius_m: draftRadius });
      }
      cancelEdit();
      setSelectedCampaignId(adjusting.id);
    }, `Đã lưu vùng "${adjusting.name}" với bán kính ${km(draftRadius)} km.`);
  }

  const stamp = () => new Date().toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const changeFilter = (value: MatchFilter) => { setFilter(value); setCursor(''); };

  if (loading && !data) return <p role="status">Đang tải bản đồ chiến dịch…</p>;
  const requests = data?.requests ?? [];

  return (
    <section className="card common-queue-suggestions">
      {error && !editMode && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice" role="status">{message}</p>}

      <CampaignAreaMap
        height="clamp(540px, 76dvh, 880px)"
        focusRequestId={mapFocus}
        note={editMode ? null : <>
          <span>💡 Nhấp đúp vào vòng chiến dịch để chỉnh vùng.</span>
          <span><i className="map-note-swatch map-note-swatch--solid" aria-hidden="true" /> Vòng nét liền: đang hoạt động</span>
          <span><i className="map-note-swatch map-note-swatch--dashed" aria-hidden="true" /> Vòng nét đứt: tạm dừng hoặc bản nháp</span>
        </>}
        alert={data && data.total > 0 ? <button type="button" className="campaign-map-alert"
          onClick={() => document.getElementById('sos-unassigned')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          <span className="campaign-map-alert__icon" aria-hidden="true">!</span>
          <span><strong>{data.total} SOS chưa có chiến dịch</strong><small>Cần quyết định ngay · bấm để xem danh sách</small></span>
        </button> : null}
        overlay={<>
          <div className="campaign-tools__bar">
            <button type="button" className="button primary" disabled={busy || editMode?.kind === 'create'} onClick={startCreate}>＋ Vẽ mới</button>
          </div>
          {editMode && <div className="campaign-tools__panel">
            <p className="campaign-tools__hint" role="status">
              {!draftCenter ? 'Chạm lên bản đồ để đặt tâm vùng.' : 'Kéo ✥ để di chuyển, kéo ↔ để đổi bán kính.'}
            </p>
            {editMode.kind === 'create' && <label>Tên chiến dịch
              <input value={draftName} maxLength={200} onChange={(event) => setDraftName(event.target.value)} placeholder="Ví dụ: Cứu trợ lũ Hải Phòng" />
            </label>}
            <label>Bán kính (m)
              <input type="number" min={500} max={MAX_RADIUS_M} step={500} value={draftRadius}
                onChange={(event) => { setDraftRadius(Math.round(Number(event.target.value))); if (editMode.kind === 'adjust') setPendingAdjustment(true); }} />
            </label>
            {draftReady && <span className="muted">≈ {km(draftRadius)} km · {coveredByDraft} SOS chưa thuộc vùng nằm trong vòng này</span>}
            {adjusting && adjusting.status === 'ACTIVE' && <span className="muted">SOS chưa thuộc vùng nằm trong vùng mới sẽ được gắn vào chiến dịch này.</span>}
            {invalidCampaignId && <p className="notice warning" role="alert">Chiến dịch này có mã dữ liệu không hợp lệ nên chưa lưu được vùng.</p>}
            {error && <p className="notice error" role="alert">{error}</p>}
            {editMode.kind === 'create' && <div className="campaign-tools__actions">
              <button type="button" className="button primary" disabled={busy || !draftReady || !draftName.trim()} onClick={() => void createFromDraft(true)}>Tạo và kích hoạt</button>
              <button type="button" className="button secondary" disabled={busy || !draftReady || !draftName.trim()} onClick={() => void createFromDraft(false)}>Lưu nháp</button>
              <button type="button" className="button secondary" disabled={busy} onClick={cancelEdit}>Hủy</button>
            </div>}
            {editMode.kind === 'adjust' && !pendingAdjustment && <div className="campaign-tools__actions">
              <button type="button" className="button secondary" disabled={busy} onClick={cancelEdit}>Đóng</button>
            </div>}
          </div>}
        </>}
        requests={selectedCampaignId ? campaignRequests : [...(data?.map_points ?? []), ...attachedPoints]}
        campaigns={data?.campaigns ?? []}
        expansion={areaExpansion}
        onExpansionComplete={finishAreaExpansion}
        selectedCampaignId={selectedCampaignId}
        onCampaignSelect={(id) => { cancelEdit(); setSelectedCampaignId(id); }}
        onCampaignEdit={(id) => { setSelectedCampaignId(id); startAdjust(id); }}
        editor={editMode ? {
          center: draftCenter, radiusM: draftRadius, hideCampaignId: adjusting?.id,
          onChange: (center, radiusM) => { setDraftCenter(center); setDraftRadius(radiusM); if (editMode.kind === 'adjust') setPendingAdjustment(true); },
        } : null}
        editActions={editMode?.kind === 'adjust' && pendingAdjustment ? {
          onConfirm: () => void saveAdjusted(), onCancel: cancelEdit, busy, canConfirm: draftReady && !invalidCampaignId,
        } : null}
        onSelect={selectedCampaignId ? undefined : (id) => {
          setHighlight(id);
          document.getElementById(`sos-suggestion-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
      />
      <p className="muted">{selectedCampaignId ? 'Đang xem SOS còn mở trong chiến dịch. Chọn chiến dịch khác ở danh sách bên dưới hoặc xem toàn cảnh.' : 'Chấm đỏ: SOS chưa gắn chiến dịch (quầng đỏ lớn hơn: trùng nhiều vùng) · chấm xanh: SOS đã gắn chiến dịch và còn mở · chấm lớn: ưu tiên P1 · vòng liền: đang hoạt động · vòng nét đứt: tạm dừng/bản nháp.'}</p>
      {selectedCampaignId && <button type="button" className="button secondary campaign-map-reset" onClick={() => setSelectedCampaignId(null)}>Xem toàn cảnh</button>}

      {data && data.clusters.length > 0 && (
        <details className="sos-fold">
          <summary>Cụm SOS gần nhau ({data.clusters.length}) — gợi ý tạo chiến dịch</summary>
          <ul className="sos-rows">
            {data.clusters.map((cluster) => (
              <li key={cluster.id}>
                <span><strong>{cluster.count} SOS</strong> gần nhau · ưu tiên cao nhất {cluster.highest_priority ?? 'chưa rõ'} · vùng gợi ý {km(cluster.suggested_radius_m)} km</span>
                <button type="button" className="button secondary" disabled={busy}
                  onClick={() => createAndActivate(`Cụm SOS ${stamp()}`, cluster.center, cluster.suggested_radius_m, `Đã tạo và kích hoạt chiến dịch cho ${cluster.count} SOS trong cụm.`)}>
                  Tạo chiến dịch cho cụm
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="suggestion-group" id="sos-unassigned">
        <div className="section-header">
          <h4>SOS chưa có chiến dịch{data ? ` (${data.total})` : ''}</h4>
          <div className="campaign-filters" role="group" aria-label="Lọc SOS chưa có chiến dịch">
            {FILTERS.map(([value, title]) => (
              <button key={value || 'all'} type="button" className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => changeFilter(value)}>{title}</button>
            ))}
          </div>
        </div>
        {data && (data.supply_need_total ?? 0) > 0 && (
          <p className="notice" role="status">
            {data.supply_need_total} SOS cần hàng chưa thuộc chiến dịch. Hãy gắn các SOS này vào chiến dịch để hàng cứu trợ được tính vào kho.
          </p>
        )}
        {data && requests.length === 0 && <p className="empty">Không còn SOS nào cần quyết định chiến dịch.</p>}
        {requests.map((item) => {
          const nearest = item.nearest_campaign;
          const nearestCampaign = nearest && data?.campaigns.find((campaign) => campaign.id === nearest.id);
          const canExpand = Boolean(nearest && nearestCampaign && !nearest.inside_area
            && nearest.suggested_radius_m <= Math.min(MAX_RADIUS_M, nearest.radius_m * 3));
          const candidates = new Set(item.candidate_campaign_ids);
          const campaignCenters = new Map(data?.campaigns.map((campaign) => [campaign.id, campaign.center]));
          const distance = (id: string) => {
            const center = campaignCenters.get(id);
            return center ? haversineM(center, { lat: item.location.latitude, lng: item.location.longitude }) : Number.POSITIVE_INFINITY;
          };
          const options = [...attachTargets].sort((a, b) =>
            Number(candidates.has(b.id)) - Number(candidates.has(a.id)) || distance(a.id) - distance(b.id));
          const savedTarget = choice[item.id] ?? (candidates.size ? options[0]?.id : '') ?? '';
          const visibleOptions = options;
          const selectedTarget = visibleOptions.some((target) => target.id === savedTarget) ? savedTarget : '';
          return (
            <article className={`suggestion-item${highlight === item.id ? ' is-highlighted' : ''}`} key={item.id} id={`sos-suggestion-${item.id}`}>
              <div className="suggestion-head">
                <div>
                  <button type="button" className="suggestion-code-link" title="Xem vị trí SOS trên bản đồ"
                    onClick={() => { setSelectedCampaignId(null); cancelEdit(); setHighlight(item.id); setMapFocus({ id: item.id, nonce: Date.now() }); }}>
                    <span aria-hidden="true">📍</span>{item.tracking_code}
                  </button>{' '}
                  {item.priority && <span className="badge">{item.priority}</span>}{' '}
                  <span className={`chip${item.campaign_match_state === 'CONFLICT' ? ' chip--warn' : ''}`}>{STATE_VI[item.campaign_match_state] ?? item.campaign_match_state}</span>{' '}
                  {item.needs_relief_supplies && <span className="chip chip--warn">Cần hàng cứu trợ</span>}
                  <p className="muted">
                    {item.campaign_match_state === 'CONFLICT'
                      ? `Nằm trong ${candidates.size || 'nhiều'} vùng; hãy chọn chiến dịch phù hợp.`
                      : nearest ? <>Gần nhất: <strong>{nearest.name}</strong> · cách {km(nearest.distance_m)} km</> : 'Chưa có chiến dịch nào có vùng.'}
                  </p>
                </div>
                <div className="suggestion-actions">
                  <div className="suggestion-actions__attach">
                    <Dropdown aria-label={`Chiến dịch để gắn ${item.tracking_code}`} value={selectedTarget} disabled={busy}
                      onChange={(event) => setChoice((current) => ({ ...current, [item.id]: event.target.value }))}>
                      <option value="">Gắn vào chiến dịch…</option>
                      {visibleOptions.map((target) => <option key={target.id} value={target.id}>
                        {candidates.has(target.id) ? 'Trong vùng · ' : ''}{target.name}{Number.isFinite(distance(target.id)) ? ` · ${km(distance(target.id))} km` : ''}
                      </option>)}
                    </Dropdown>
                    <button type="button" className="button primary" disabled={busy || !selectedTarget} onClick={() => void attach(item, selectedTarget)}>Gắn</button>
                  </div>
                  <div className="suggestion-actions__alternatives">
                    {canExpand && nearestCampaign && nearest && (
                      <button type="button" className="button secondary suggestion-actions__expand" disabled={busy} onClick={() => void expandArea(nearestCampaign, nearest.suggested_radius_m)}>
                        Mở rộng {nearest.name} đến {km(nearest.suggested_radius_m)} km
                      </button>
                    )}
                    <button type="button" className="button secondary suggestion-actions__create" disabled={busy}
                      onClick={() => void createAndActivate(`SOS ${item.tracking_code}`, item.location, NEW_CAMPAIGN_RADIUS_M, `Đã tạo và kích hoạt chiến dịch tại ${item.tracking_code}.`)}>
                      Tạo chiến dịch mới tại đây
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
        <Pager page={pageIndex} hasNext={Boolean(data?.more)} loading={loading || busy} onPrev={prevPage}
          onNext={() => data?.cursor && setCursor(data.cursor)} count={requests.length} noun="SOS" />
      </div>
    </section>
  );
}
