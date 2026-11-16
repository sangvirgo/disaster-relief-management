import { useEffect, useMemo, useState } from 'react';
import { api, newCommandKey } from '../../api/client';
import { CampaignAreaMap } from '../../maps/CampaignAreaMap';

type LatLng = { latitude: number; longitude: number };
type SuggestionRequest = {
  id: string;
  tracking_code: string;
  priority: string | null;
  status: string;
  version: number;
  campaign_match_state: string;
  location: LatLng;
  nearest_campaign: {
    id: string;
    name: string;
    status: string;
    version: number;
    radius_m: number;
    distance_m: number;
    inside_area: boolean;
    suggested_radius_m: number;
  } | null;
};
type SuggestionCluster = {
  id: string;
  request_ids: string[];
  count: number;
  center: LatLng;
  suggested_radius_m: number;
  highest_priority: string | null;
};
type SuggestionCampaign = {
  id: string;
  name: string;
  status: string;
  version: number;
  center: { lat: number; lng: number };
  radius_m: number;
};
type Suggestions = { requests: SuggestionRequest[]; clusters: SuggestionCluster[]; campaigns: SuggestionCampaign[] };

// Area used when a SOS is outside every campaign and there is no nearby campaign to extend.
const NEW_CAMPAIGN_RADIUS_M = 3_000;
const MAX_RADIUS_M = 300_000;

const STATE_VI: Record<string, string> = { UNMATCHED: 'Ngoài mọi vùng chiến dịch', CONFLICT: 'Trùng nhiều vùng chiến dịch' };
const STATUS_VI: Record<string, string> = { DRAFT: 'bản nháp', ACTIVE: 'đang hoạt động', PAUSED: 'tạm dừng' };

const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : 'Chưa thực hiện được thao tác. Hãy thử lại.');
function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (value: number) => value * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
const km = (meters: number) => (meters / 1000).toFixed(1).replace('.', ',');
const post = <T,>(path: string, body: unknown) =>
  api<T>('response', path, { method: 'POST', body, idempotencyKey: newCommandKey() });

type Group = { campaign: SuggestionCampaign; items: SuggestionRequest[] };

function SosLabel({ item }: { item: SuggestionRequest }) {
  return (
    <span className="sos-label">
      <strong>{item.tracking_code}</strong>
      {item.priority && <span className="badge">{item.priority}</span>}
      <span className="muted">{STATE_VI[item.campaign_match_state] ?? item.campaign_match_state}</span>
    </span>
  );
}

function SosRows({ items, highlight }: { items: SuggestionRequest[]; highlight: string }) {
  return (
    <ul className="sos-rows">
      {items.map((item) => (
        <li key={item.id} id={`sos-suggestion-${item.id}`} className={highlight === item.id ? 'is-highlighted' : ''}>
          <SosLabel item={item} />
          {item.nearest_campaign && !item.nearest_campaign.inside_area && (
            <span className="muted">cách {km(item.nearest_campaign.distance_m)} km</span>
          )}
        </li>
      ))}
    </ul>
  );
}

// One action per target campaign instead of one button per SOS. Far-away SOS get their own campaign rather than a huge area.
function groupRequests(data: Suggestions | null) {
  const attach = new Map<string, Group>();
  const inactive = new Map<string, Group>();
  const expand = new Map<string, Group & { radiusM: number }>();
  const isolated: SuggestionRequest[] = [];
  for (const item of data?.requests ?? []) {
    const nearest = item.nearest_campaign;
    const campaign = nearest && data?.campaigns.find((entry) => entry.id === nearest.id);
    if (!nearest || !campaign || nearest.suggested_radius_m > Math.min(MAX_RADIUS_M, nearest.radius_m * 3)) {
      isolated.push(item);
    } else if (nearest.inside_area) {
      const map = nearest.status === 'ACTIVE' ? attach : inactive;
      map.set(campaign.id, { campaign, items: [...(map.get(campaign.id)?.items ?? []), item] });
    } else {
      const current = expand.get(campaign.id);
      expand.set(campaign.id, {
        campaign,
        items: [...(current?.items ?? []), item],
        radiusM: Math.max(current?.radiusM ?? 0, nearest.suggested_radius_m),
      });
    }
  }
  return { attach: [...attach.values()], inactive: [...inactive.values()], expand: [...expand.values()], isolated };
}

/**
 * Control panel for the primary coordinator: turns unmatched/conflicting SOS into campaign-level decisions.
 * Each suggestion is one action; individual SOS care stays with campaign coordinators.
 */
export function CommonQueueSuggestions({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<Suggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [highlight, setHighlight] = useState('');
  // Map editor: draw a new campaign area, or adjust an existing one (kind 'adjust' carries the campaign id).
  const [editMode, setEditMode] = useState<{ kind: 'create' } | { kind: 'adjust'; id: string } | null>(null);
  const [draftCenter, setDraftCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [draftRadius, setDraftRadius] = useState(3000);
  const [draftName, setDraftName] = useState('');

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api<Suggestions>('response', '/campaigns/common-queue/suggestions')
      .then((value) => { if (live) setData(value); })
      .catch((cause) => { if (live) setError(messageOf(cause)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [revision]);

  function attachMany(items: SuggestionRequest[], campaignId: string) {
    return run(async () => {
      let failed = 0;
      for (const item of items) {
        try { await post(`/requests/${item.id}/attach-campaign`, { campaign_id: campaignId, expected_version: item.version }); }
        catch { failed += 1; }
      }
      if (failed) throw new Error(`Chưa gắn được ${failed}/${items.length} SOS. Danh sách đã được làm mới, hãy thử lại.`);
    }, `Đã gắn ${items.length} SOS vào chiến dịch.`);
  }

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(success);
      onChanged();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
      setRevision((value) => value + 1);
    }
  }

  function expandArea(campaign: SuggestionCampaign, radiusM: number, attached: boolean) {
    return run(
      () => post(`/campaigns/${campaign.id}/area`, {
        expected_version: campaign.version,
        center: campaign.center,
        radius_m: radiusM,
      }).then(() => undefined),
      attached ? `Đã mở rộng vùng ${campaign.name} và gắn các SOS trong vùng mới.` : `Đã mở rộng vùng ${campaign.name}.`,
    );
  }

  function createAndActivate(name: string, center: LatLng, radiusM: number, success: string) {
    return run(async () => {
      const created = await post<{ id: string; version: number }>('/campaigns', {
        name,
        center: { lat: center.latitude, lng: center.longitude },
        radius_m: radiusM,
      });
      try {
        await post(`/campaigns/${created.id}/activate`, { expected_version: created.version });
      } catch (cause) {
        throw new Error(`Đã tạo chiến dịch "${name}" nhưng chưa kích hoạt được: ${messageOf(cause)} Hãy kích hoạt trong danh sách chiến dịch bên dưới.`);
      }
    }, success);
  }

  function startCreate() {
    setEditMode({ kind: 'create' }); setDraftCenter(null); setDraftRadius(NEW_CAMPAIGN_RADIUS_M); setDraftName('');
    setError(''); setMessage('');
  }
  function startAdjust(id: string) {
    const campaign = data?.campaigns.find((item) => item.id === id);
    if (!campaign) { setEditMode(null); return; }
    setEditMode({ kind: 'adjust', id }); setDraftCenter(campaign.center); setDraftRadius(campaign.radius_m);
    setError(''); setMessage('');
  }
  function cancelEdit() { setEditMode(null); setDraftCenter(null); }
  const draftReady = Boolean(draftCenter) && Number.isInteger(draftRadius) && draftRadius >= 500 && draftRadius <= MAX_RADIUS_M;
  const coveredByDraft = useMemo(() => {
    if (!draftCenter || !data) return 0;
    return data.requests.filter((item) => haversineM(draftCenter, { lat: item.location.latitude, lng: item.location.longitude }) <= draftRadius).length;
  }, [data, draftCenter, draftRadius]);
  const adjusting = editMode?.kind === 'adjust' ? data?.campaigns.find((item) => item.id === editMode.id) : undefined;

  async function createFromDraft(activate: boolean) {
    if (!draftCenter || !draftReady) return;
    const name = draftName.trim().normalize('NFC');
    if (!name) { setError('Hãy đặt tên cho chiến dịch.'); return; }
    await run(async () => {
      const created = await post<{ id: string; version: number }>('/campaigns', {
        name, center: draftCenter, radius_m: draftRadius,
      });
      if (activate) {
        try { await post(`/campaigns/${created.id}/activate`, { expected_version: created.version }); }
        catch (cause) { throw new Error(`Đã tạo chiến dịch "${name}" nhưng chưa kích hoạt được: ${messageOf(cause)}`); }
      }
      cancelEdit();
    }, activate ? `Đã tạo và kích hoạt chiến dịch "${name}".` : `Đã lưu bản nháp "${name}".`);
  }
  async function saveAdjusted() {
    if (!adjusting || !draftCenter || !draftReady) return;
    await run(async () => {
      if (adjusting.status === 'DRAFT') {
        await api('response', `/campaigns/${adjusting.id}`, {
          method: 'PATCH', body: { expected_version: adjusting.version, center: draftCenter, radius_m: draftRadius }, idempotencyKey: newCommandKey(),
        });
      } else {
        await post(`/campaigns/${adjusting.id}/area`, { expected_version: adjusting.version, center: draftCenter, radius_m: draftRadius });
      }
      cancelEdit();
    }, `Đã cập nhật vùng "${adjusting.name}".`);
  }

  const stamp = () => new Date().toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  const groups = groupRequests(data);

  if (loading && !data) return <p role="status">Đang tải gợi ý vùng SOS…</p>;

  return (
    <section className="card common-queue-suggestions">
      <div className="section-header">
        <div>
          <h3>Bản đồ chiến dịch</h3>
        </div>
        <button type="button" className="button secondary" disabled={loading || busy} onClick={() => setRevision((value) => value + 1)}>
          Làm mới gợi ý
        </button>
      </div>
            {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice" role="status">{message}</p>}

      <div className="campaign-area-editor">
        <div className="campaign-area-editor__row">
          <button type="button" className="button primary" disabled={busy || editMode?.kind === 'create'} onClick={startCreate}>Vẽ chiến dịch mới trên bản đồ</button>
          <label>Chỉnh vùng chiến dịch
            <select value={editMode?.kind === 'adjust' ? editMode.id : ''} disabled={busy} onChange={(event) => event.target.value ? startAdjust(event.target.value) : cancelEdit()}>
              <option value="">Chọn chiến dịch…</option>
              {data?.campaigns.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        </div>
        {editMode && <>
          <p className="notice" role="status">
            {!draftCenter ? 'Chạm lên bản đồ để đặt tâm vùng.' : 'Kéo ✥ để di chuyển vùng, kéo ↔ ở mép vòng để đổi bán kính.'}
          </p>
          <div className="campaign-area-editor__row">
            {editMode.kind === 'create' && <label>Tên chiến dịch
              <input value={draftName} maxLength={200} onChange={(event) => setDraftName(event.target.value)} placeholder="Ví dụ: Cứu trợ lũ Hải Phòng" />
            </label>}
            <label>Bán kính (m)
              <input type="number" min={500} max={MAX_RADIUS_M} step={500} value={draftRadius}
                onChange={(event) => setDraftRadius(Math.round(Number(event.target.value)))} />
            </label>
            {draftReady && <span className="muted">≈ {km(draftRadius)} km · {coveredByDraft} SOS chưa thuộc vùng nằm trong vòng này</span>}
          </div>
          <div className="campaign-area-editor__row">
            {editMode.kind === 'create' ? <>
              <button type="button" className="button primary" disabled={busy || !draftReady || !draftName.trim()} onClick={() => void createFromDraft(true)}>Tạo và kích hoạt</button>
              <button type="button" className="button secondary" disabled={busy || !draftReady || !draftName.trim()} onClick={() => void createFromDraft(false)}>Lưu bản nháp</button>
            </> : <button type="button" className="button primary" disabled={busy || !draftReady} onClick={() => void saveAdjusted()}>
              Lưu vùng mới
            </button>}
            <button type="button" className="button secondary" disabled={busy} onClick={cancelEdit}>Hủy</button>
          </div>
          {adjusting && adjusting.status === 'ACTIVE' && <p className="muted">SOS chưa thuộc vùng nằm trong vùng mới sẽ được gắn vào chiến dịch này.</p>}
        </>}
      </div>
      <CampaignAreaMap
        requests={data?.requests ?? []}
        campaigns={data?.campaigns ?? []}
        editor={editMode ? {
          center: draftCenter, radiusM: draftRadius, hideCampaignId: adjusting?.id,
          onChange: (center, radiusM) => { setDraftCenter(center); setDraftRadius(radiusM); },
        } : null}
        onSelect={(id) => {
          setHighlight(id);
          document.getElementById(`sos-suggestion-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
      />
      <p className="muted">
        Chấm cam: ngoài mọi vùng · chấm tím: trùng nhiều vùng · chấm lớn: ưu tiên P1 · vòng liền: đang hoạt động · vòng nét đứt: tạm dừng/bản nháp.
      </p>

      {data && data.clusters.length > 0 && (
        <div className="suggestion-group">
          <h4>Cụm SOS gần nhau ({data.clusters.length})</h4>
          {data.clusters.map((cluster) => (
            <article className="card suggestion-item" key={cluster.id}>
              <p>
                <strong>{cluster.count} SOS</strong> nằm gần nhau · mức ưu tiên cao nhất: {cluster.highest_priority ?? 'chưa rõ'} ·
                vùng gợi ý bán kính {km(cluster.suggested_radius_m)} km
              </p>
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() => createAndActivate(
                  `Cụm SOS ${stamp()}`,
                  cluster.center,
                  cluster.suggested_radius_m,
                  `Đã tạo và kích hoạt chiến dịch cho ${cluster.count} SOS trong cụm.`,
                )}
              >
                Tạo chiến dịch cho cụm này
              </button>
            </article>
          ))}
        </div>
      )}

      <div className="suggestion-group">
        <h4>SOS chưa thuộc chiến dịch ({data?.requests.length ?? 0})</h4>
        {data && data.requests.length === 0 && <p className="empty">Không còn SOS nào chưa thuộc chiến dịch.</p>}

        {groups.attach.map(({ campaign, items }) => (
          <article className="card suggestion-item" key={`attach-${campaign.id}`}>
            <div className="suggestion-head">
              <div>
                <strong>Gắn vào {campaign.name}</strong>
                <p className="muted">{items.length} SOS đã nằm trong vùng chiến dịch đang hoạt động.</p>
              </div>
              <button type="button" className="button primary" disabled={busy} onClick={() => attachMany(items, campaign.id)}>
                {items.length > 1 ? `Gắn ${items.length} SOS` : 'Gắn SOS'}
              </button>
            </div>
            <SosRows items={items} highlight={highlight} />
          </article>
        ))}

        {groups.expand.map(({ campaign, items, radiusM }) => (
          <article className="card suggestion-item" key={`expand-${campaign.id}`}>
            <div className="suggestion-head">
              <div>
                <strong>Mở rộng vùng {campaign.name}</strong>
                <p className="muted">
                  {items.length} SOS nằm ngay ngoài vùng · bán kính {km(campaign.radius_m)} km → {km(radiusM)} km.
                  {campaign.status !== 'ACTIVE' && ' Chiến dịch chưa hoạt động nên SOS sẽ chưa được gắn tự động.'}
                </p>
              </div>
              <button type="button" className="button primary" disabled={busy} onClick={() => expandArea(campaign, radiusM, campaign.status === 'ACTIVE')}>
                Mở rộng đến {km(radiusM)} km
              </button>
            </div>
            <SosRows items={items} highlight={highlight} />
          </article>
        ))}

        {groups.isolated.length > 0 && (
          <article className="card suggestion-item">
            <strong>SOS ở xa mọi chiến dịch ({groups.isolated.length})</strong>
            <p className="muted">Mở rộng vùng sẽ quá lớn, nên nên tạo chiến dịch riêng tại vị trí SOS.</p>
            <ul className="sos-rows">
              {groups.isolated.map((item) => (
                <li key={item.id} id={`sos-suggestion-${item.id}`} className={highlight === item.id ? 'is-highlighted' : ''}>
                  <SosLabel item={item} />
                  {item.nearest_campaign && <span className="muted">Cách {item.nearest_campaign.name} {km(item.nearest_campaign.distance_m)} km</span>}
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => createAndActivate(`SOS ${item.tracking_code}`, item.location, NEW_CAMPAIGN_RADIUS_M, `Đã tạo và kích hoạt chiến dịch tại ${item.tracking_code}.`)}
                  >
                    Tạo chiến dịch tại đây
                  </button>
                </li>
              ))}
            </ul>
          </article>
        )}

        {groups.inactive.map(({ campaign, items }) => (
          <article className="card suggestion-item" key={`inactive-${campaign.id}`}>
            <strong>{items.length} SOS nằm trong vùng {campaign.name}</strong>
            <p className="muted">Chiến dịch đang {STATUS_VI[campaign.status] ?? campaign.status}. Kích hoạt chiến dịch trong danh sách bên dưới để gắn SOS.</p>
            <SosRows items={items} highlight={highlight} />
          </article>
        ))}
      </div>
    </section>
  );
}
