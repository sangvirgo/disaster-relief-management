import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);

const tileUrl = (import.meta.env.VITE_OSM_TILE_URL as string | undefined)?.trim() || '';
const mapStyleUrl =
  (import.meta.env.VITE_OPENFREEMAP_STYLE_URL as string | undefined)?.trim() ||
  'https://tiles.openfreemap.org/styles/liberty';
const tileAttribution =
  (import.meta.env.VITE_OSM_TILE_ATTRIBUTION as string | undefined)?.trim() ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const CAMPAIGN_STATUS_VI: Record<string, string> = {
  DRAFT: 'Bản nháp',
  ACTIVE: 'Đang hoạt động',
  PAUSED: 'Tạm dừng',
  CLOSED: 'Đã kết thúc',
};

// Distinct hues so nested or overlapping areas can be told apart; the legend below the map uses the same order.
const AREA_COLORS = ['#2563eb', '#059669', '#d97706', '#db2777', '#0891b2', '#65a30d', '#9333ea', '#dc2626'];
const areaColor = (index: number) => AREA_COLORS[index % AREA_COLORS.length]!;

export type AreaMapRequest = {
  id: string;
  tracking_code: string;
  priority: string | null;
  campaign_match_state: string;
  location: { latitude: number; longitude: number };
};

export type AreaMapCampaign = {
  id: string;
  name: string;
  status: string;
  center: { lat: number; lng: number };
  radius_m: number;
};

/** Read-only overview: campaign areas plus unmatched SOS. Clicking a SOS marker reports its id. */
export function CampaignAreaMap({
  requests,
  campaigns,
  onSelect,
}: {
  requests: AreaMapRequest[];
  campaigns: AreaMapCampaign[];
  onSelect?: (requestId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { center: [16.1, 107.7], zoom: 6 });
    if (tileUrl) {
      L.tileLayer(tileUrl, { attribution: tileAttribution, maxZoom: 19 }).addTo(map);
    } else {
      maplibreGL({ style: mapStyleUrl, locale: { 'Map.Title': 'Bản đồ' } }).addTo(map);
    }
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    const timer = window.setTimeout(() => map.invalidateSize(), 200);
    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const bounds: L.LatLngTuple[] = [];
    campaigns.forEach((campaign, index) => {
      const active = campaign.status === 'ACTIVE';
      const color = areaColor(index);
      L.circle([campaign.center.lat, campaign.center.lng], {
        radius: campaign.radius_m,
        color,
        weight: 2,
        dashArray: active ? undefined : '6 4',
        fillColor: color,
        fillOpacity: 0.07,
        interactive: false,
      }).addTo(layer);
      // Name sits on the circle's northern edge, so nested circles get labels at different heights.
      const edge: L.LatLngTuple = [campaign.center.lat + campaign.radius_m / 111_320, campaign.center.lng];
      L.marker(edge, {
        interactive: false,
        icon: L.divIcon({
          className: 'campaign-area-label',
          html: `<span style="border-color:${color};color:${color}">${index + 1}</span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      }).addTo(layer);
      bounds.push([campaign.center.lat, campaign.center.lng]);
    });
    for (const request of requests) {
      const position: L.LatLngTuple = [request.location.latitude, request.location.longitude];
      L.circleMarker(position, {
        radius: request.priority === 'P1' ? 9 : 6,
        color: '#ffffff',
        weight: 1.5,
        fillColor: request.campaign_match_state === 'CONFLICT' ? '#7c3aed' : '#ea580c',
        fillOpacity: 0.95,
      })
        .bindTooltip(`${request.tracking_code}${request.priority ? ` · ${request.priority}` : ''}`)
        .on('click', () => selectRef.current?.(request.id))
        .addTo(layer);
      bounds.push(position);
    }
    if (bounds.length) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 });
  }, [requests, campaigns]);

  return (
    <>
      <div
        ref={containerRef}
        className="campaign-area-map"
        role="region"
        aria-label="Bản đồ chiến dịch và SOS cần quyết định"
        style={{ height: 380, width: '100%', borderRadius: 8 }}
      />
      {campaigns.length > 0 && (
        <ol className="campaign-area-legend" aria-label="Chú giải vùng chiến dịch">
          {campaigns.map((campaign, index) => (
            <li key={campaign.id}>
              <span className="campaign-area-legend__badge" style={{ borderColor: areaColor(index), color: areaColor(index) }}>{index + 1}</span>
              {campaign.name}
              <span className="muted"> · {CAMPAIGN_STATUS_VI[campaign.status] ?? campaign.status} · bán kính {(campaign.radius_m / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km</span>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
