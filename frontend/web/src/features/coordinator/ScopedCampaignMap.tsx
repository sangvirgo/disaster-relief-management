import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { CampaignAreaMap, type AreaMapCampaign, type AreaMapRequest } from '../../maps/CampaignAreaMap';

type ScopedCampaign = { id: string; name: string; status: string; center: { lat: number; lng: number } | null; radius_m: number | null };
type RequestPage = {
  items: Array<{ id: string; tracking_code: string; status: string; priority: string | null; approx_location?: { latitude: number; longitude: number } | null }>;
  more: boolean;
  cursor?: string;
};

const CLOSED = ['RESOLVED', 'CLOSED', 'CANCELLED', 'REJECTED', 'DUPLICATE'];
const LANES = ['NORMAL', 'RATE_LIMITED_REVIEW', 'PROXY_QUOTA_REVIEW'];

/**
 * Read-only campaign map for a coordinator who works only the campaigns assigned to them (campaign-scoped grant or an
 * active engagement). It shows those campaign areas and their open SOS. It never offers drawing, adjusting or the
 * shared "SOS without a campaign" queue, so conflicts stay with the primary coordinator.
 */
export function ScopedCampaignMap({ campaigns, campaignIds }: { campaigns: ScopedCampaign[]; campaignIds: string[] }) {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [points, setPoints] = useState<AreaMapRequest[]>([]);
  const [error, setError] = useState('');

  const mine = useMemo<AreaMapCampaign[]>(() => campaigns
    .filter((campaign) => campaignIds.includes(campaign.id) && campaign.center && campaign.radius_m)
    .map((campaign) => ({ id: campaign.id, name: campaign.name, status: campaign.status, center: campaign.center!, radius_m: campaign.radius_m! })),
  [campaigns, campaignIds]);
  const key = mine.map((campaign) => campaign.id).join(',');

  useEffect(() => {
    let live = true;
    setError('');
    const targets = selectedCampaignId ? [selectedCampaignId] : mine.map((campaign) => campaign.id);
    const load = async () => {
      const found = new Map<string, AreaMapRequest>();
      for (const campaignId of targets) {
        for (const lane of LANES) {
          let next = '';
          let guard = 0;
          do {
            const params = new URLSearchParams({ campaign_id: campaignId, review_lane: lane, limit: '100' });
            if (next) params.set('cursor', next);
            const page = await api<RequestPage>('response', `/requests?${params}`);
            for (const item of page.items) {
              if (CLOSED.includes(item.status) || !item.approx_location) continue;
              found.set(item.id, { id: item.id, tracking_code: item.tracking_code, priority: item.priority, campaign_match_state: 'CAMPAIGN', location: item.approx_location });
            }
            next = page.more ? page.cursor ?? '' : '';
            guard += 1;
          } while (next && guard < 10);
        }
      }
      if (live) setPoints([...found.values()]);
    };
    void load().catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Không tải được SOS của chiến dịch.'); });
    return () => { live = false; };
    // `mine` is derived from `key`; reloading is keyed on the campaign set and selection only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, selectedCampaignId]);

  return (
    <section className="card common-queue-suggestions">
      {error && <p className="notice error" role="alert">{error}</p>}
      <p className="notice" role="status">
        Bạn đang xem các chiến dịch được giao. SOS chưa có chiến dịch hoặc trùng nhiều vùng do điều phối viên chính xử lý.
      </p>
      {mine.length === 0
        ? <p className="empty">Bạn chưa được giao chiến dịch nào có vùng trên bản đồ.</p>
        : <>
          <CampaignAreaMap
            requests={points}
            campaigns={mine}
            height="clamp(480px, 70dvh, 820px)"
            selectedCampaignId={selectedCampaignId}
            onCampaignSelect={(id) => setSelectedCampaignId((current) => (current === id ? null : id))}
            note={<>
              <span>💡 Bấm vào số trên vòng để xem riêng SOS của chiến dịch.</span>
              <span><i className="map-note-swatch map-note-swatch--solid" aria-hidden="true" /> Vòng nét liền: đang hoạt động</span>
              <span><i className="map-note-swatch map-note-swatch--dashed" aria-hidden="true" /> Vòng nét đứt: tạm dừng hoặc bản nháp</span>
            </>}
          />
          <p className="muted">Chấm xanh: SOS đang mở trong chiến dịch · chấm lớn: ưu tiên P1.</p>
          {selectedCampaignId && <button type="button" className="button secondary campaign-map-reset" onClick={() => setSelectedCampaignId(null)}>Xem tất cả chiến dịch của tôi</button>}
        </>}
    </section>
  );
}
