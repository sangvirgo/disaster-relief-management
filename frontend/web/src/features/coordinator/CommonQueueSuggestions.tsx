import { useEffect, useState } from 'react';
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
        throw new Error(`Đã tạo chiến dịch "${name}" nhưng chưa kích hoạt được: ${messageOf(cause)} Hãy kích hoạt trong tab Quản lý chiến dịch.`);
      }
    }, success);
  }

  const stamp = () => new Date().toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  const groups = groupRequests(data);

  if (loading && !data) return <p role="status">Đang tải gợi ý vùng SOS…</p>;

  return (
    <section className="card common-queue-suggestions">
      <div className="section-header">
        <div>
          <span className="eyebrow">Gợi ý cho điều phối chính</span>
          <h3>Quyết định cấp chiến dịch</h3>
        </div>
        <button type="button" className="button secondary" disabled={loading || busy} onClick={() => setRevision((value) => value + 1)}>
          Làm mới gợi ý
        </button>
      </div>
      <p>Mỗi gợi ý là một thao tác với chiến dịch. Sau khi SOS được gắn, điều phối viên chiến dịch sẽ tiếp nhận và chăm sóc từng ca.</p>
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice" role="status">{message}</p>}

      <CampaignAreaMap
        requests={data?.requests ?? []}
        campaigns={data?.campaigns ?? []}
        onSelect={(id) => {
          setHighlight(id);
          document.getElementById(`sos-suggestion-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
      />
      <p className="muted">
        Chấm cam: ngoài mọi vùng · chấm tím: trùng nhiều vùng · chấm lớn: ưu tiên P1 · vòng liền: chiến dịch đang hoạt động · vòng nét đứt: chiến dịch tạm dừng/bản nháp. Số trên vòng khớp với danh sách bên dưới bản đồ.
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
            <p className="muted">Chiến dịch đang {STATUS_VI[campaign.status] ?? campaign.status}. Kích hoạt chiến dịch trong tab Quản lý để gắn SOS.</p>
            <SosRows items={items} highlight={highlight} />
          </article>
        ))}
      </div>
    </section>
  );
}
