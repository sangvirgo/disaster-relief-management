import { useEffect, useRef, useState, type ReactNode } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

import { WeatherLayers } from './WeatherLayers';

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

export type AreaEditor = {
  /** Area being drawn or adjusted; null until the coordinator taps the map. */
  center: { lat: number; lng: number } | null;
  radiusM: number;
  /** Campaign being adjusted: its saved circle is hidden while the editable one is shown. */
  hideCampaignId?: string;
  /** Allowed radius for drag handles and drawing; defaults to the campaign range. */
  radiusRange?: { min: number; max: number };
  onChange: (center: { lat: number; lng: number }, radiusM: number) => void;
};

export type AreaExpansion = {
  id: string;
  name: string;
  center: { lat: number; lng: number };
  fromRadiusM: number;
  toRadiusM: number;
  nonce: number;
};

const RADIUS_MIN_M = 500;
const RADIUS_MAX_M = 300_000;
const clampRadius = (radius: number, range?: { min: number; max: number }) =>
  Math.min(range?.max ?? RADIUS_MAX_M, Math.max(range?.min ?? RADIUS_MIN_M, radius));
const editHandleIcon = (kind: 'center' | 'radius') => L.divIcon({
  className: `campaign-edit-handle campaign-edit-handle--${kind}`,
  html: `<span aria-hidden="true">${kind === 'center' ? '+' : '↔'}</span>`,
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});
const eastOf = (center: { lat: number; lng: number }, radiusM: number): L.LatLngTuple =>
  [center.lat, center.lng + radiusM / (111_320 * Math.cos(center.lat * Math.PI / 180))];

/** Campaign areas plus unmatched SOS. With `editor`, the coordinator draws (tap), moves (drag centre) and resizes (drag edge handle) one area. */
export function CampaignAreaMap({
  requests,
  campaigns,
  onSelect,
  editor,
  selectedCampaignId,
  onCampaignSelect,
  onCampaignEdit,
  editActions,
  overlay,
  focusRequestId,
  expansion,
  onExpansionComplete,
  note,
  alert,
  height = 380,
  ariaLabel = 'Bản đồ chiến dịch và SOS cần quyết định',
}: {
  requests: AreaMapRequest[];
  campaigns: AreaMapCampaign[];
  onSelect?: (requestId: string) => void;
  editor?: AreaEditor | null;
  selectedCampaignId?: string | null;
  onCampaignSelect?: (id: string) => void;
  onCampaignEdit?: (id: string) => void;
  editActions?: { onConfirm: () => void; onCancel: () => void; busy: boolean; canConfirm: boolean } | null;
  /** Controls drawn over the map (bottom-right), e.g. draw / adjust campaign tools. */
  overlay?: ReactNode;
  /** Short hint pill under the weather chips, and an urgent warning pinned bottom-right. */
  note?: ReactNode;
  /** Pan/zoom to one SOS marker and pulse it; a new `nonce` re-triggers the focus. */
  focusRequestId?: { id: string; nonce: number } | null;
  /** Animate a saved campaign area from its previous radius after the server confirms expansion. */
  expansion?: AreaExpansion | null;
  onExpansionComplete?: () => void;
  alert?: ReactNode;
  height?: number | string;
  ariaLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const editLayerRef = useRef<L.LayerGroup | null>(null);
  const expansionLayerRef = useRef<L.LayerGroup | null>(null);
  const boundsRef = useRef<L.LatLngTuple[]>([]);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const campaignSelectRef = useRef(onCampaignSelect);
  campaignSelectRef.current = onCampaignSelect;
  const campaignEditRef = useRef(onCampaignEdit);
  campaignEditRef.current = onCampaignEdit;
  const expansionCompleteRef = useRef(onExpansionComplete);
  expansionCompleteRef.current = onExpansionComplete;
  const focusedRef = useRef(false);
  const markersRef = useRef(new Map<string, L.CircleMarker>());
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { center: [16.1, 107.7], zoom: 6 });
    if (tileUrl) {
      L.tileLayer(tileUrl, { attribution: tileAttribution, maxZoom: 19 }).addTo(map);
    } else {
      maplibreGL({ style: mapStyleUrl, locale: { 'Map.Title': 'Bản đồ' } }).addTo(map);
    }
    mapRef.current = map;
    setMapInstance(map);
    layerRef.current = L.layerGroup().addTo(map);
    editLayerRef.current = L.layerGroup().addTo(map);
    expansionLayerRef.current = L.layerGroup().addTo(map);
    map.on('click', (event: L.LeafletMouseEvent) => {
      const current = editorRef.current;
      if (!current) return;
      const center = { lat: event.latlng.lat, lng: event.latlng.lng };
      current.onChange(center, current.radiusM);
      const bounds = L.circle([center.lat, center.lng], { radius: current.radiusM }).getBounds();
      map.stop();
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: true });
    });
    // The container may still be laying out when the first fit runs, so size is re-read and the view re-fitted once.
    const timer = window.setTimeout(() => {
      map.invalidateSize();
      if (boundsRef.current.length && !focusedRef.current) map.fitBounds(boundsRef.current, { padding: [24, 24], maxZoom: 12, animate: false });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      map.remove();
      setMapInstance(null);
      mapRef.current = null;
      layerRef.current = null;
      editLayerRef.current = null;
      expansionLayerRef.current = null;
    };
  }, []);

  const hideId = editor?.hideCampaignId;
  const expandingId = expansion?.id;
  const editing = Boolean(editor);
  const centerLat = editor?.center?.lat;
  const centerLng = editor?.center?.lng;
  const editRadius = editor?.radiusM;
  useEffect(() => {
    const map = mapRef.current;
    const layer = editLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    map.getContainer().style.cursor = editing && centerLat === undefined ? 'crosshair' : '';
    if (!editing || centerLat === undefined || centerLng === undefined || editRadius === undefined) return;
    const center = { lat: centerLat, lng: centerLng };
    const circle = L.circle([center.lat, center.lng], {
      radius: editRadius, color: '#111827', weight: 3, dashArray: '8 5', fillColor: '#2563eb', fillOpacity: 0.12, interactive: false,
    }).addTo(layer);
    const centerMarker = L.marker([center.lat, center.lng], { icon: editHandleIcon('center'), draggable: true, zIndexOffset: 2000 })
      .bindTooltip('Kéo để di chuyển vùng').addTo(layer);
    const radiusMarker = L.marker(eastOf(center, editRadius), { icon: editHandleIcon('radius'), draggable: true, zIndexOffset: 2000 })
      .bindTooltip('Kéo để đổi bán kính').addTo(layer);
    map.invalidateSize();
    map.stop();
    map.fitBounds(circle.getBounds(), { padding: [40, 40], maxZoom: 14, animate: false });
    const commit = (nextCenter: { lat: number; lng: number }, radius: number) =>
      editorRef.current?.onChange(nextCenter, clampRadius(Math.round(radius / 100) * 100, editorRef.current?.radiusRange));
    centerMarker.on('drag', () => {
      const at = centerMarker.getLatLng();
      circle.setLatLng(at);
      radiusMarker.setLatLng(eastOf({ lat: at.lat, lng: at.lng }, editRadius));
    });
    centerMarker.on('dragend', () => { const at = centerMarker.getLatLng(); commit({ lat: at.lat, lng: at.lng }, editRadius); });
    radiusMarker.on('drag', () => {
      const radius = clampRadius(map.distance([center.lat, center.lng], radiusMarker.getLatLng()), editorRef.current?.radiusRange);
      circle.setRadius(radius);
    });
    radiusMarker.on('dragend', () => commit(center, map.distance([center.lat, center.lng], radiusMarker.getLatLng())));
  }, [editing, centerLat, centerLng, editRadius]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersRef.current.clear();
    const bounds: L.LatLngTuple[] = [];
    campaigns.forEach((campaign, index) => {
      if (campaign.id === hideId || campaign.id === expandingId) return;
      const active = campaign.status === 'ACTIVE';
      const color = areaColor(index);
      L.circle([campaign.center.lat, campaign.center.lng], {
        radius: campaign.radius_m,
        color,
        weight: 2,
        dashArray: active ? undefined : '6 4',
        fillColor: color,
        fillOpacity: 0.07,
        className: 'campaign-area-circle',
      }).on('dblclick', (event: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(event);
        campaignEditRef.current?.(campaign.id);
      }).bindTooltip(`${campaign.name} · nhấp đúp để chỉnh vùng`, { sticky: true }).addTo(layer);
      // Name sits on the circle's northern edge, so nested circles get labels at different heights.
      const edge: L.LatLngTuple = [campaign.center.lat + campaign.radius_m / 111_320, campaign.center.lng];
      L.marker(edge, {
        interactive: true,
        icon: L.divIcon({
          className: 'campaign-area-label',
          html: `<span style="border-color:${color};color:${color}">${index + 1}</span>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
      }).bindTooltip(campaign.name).on('click', () => campaignSelectRef.current?.(campaign.id))
        .on('dblclick', () => campaignEditRef.current?.(campaign.id)).addTo(layer);
      bounds.push([campaign.center.lat, campaign.center.lng]);
    });
    // SOS dots live in their own pane above the campaign number badges, so a dot is never hidden under a circle label.
    const dotPane = map.getPane('sos-dots') ?? map.createPane('sos-dots');
    dotPane.style.zIndex = '650';
    const dotRenderer = L.svg({ pane: 'sos-dots' });
    // Conflicts are drawn last (on top) and with a red halo so they stand out from the blue dots.
    const unassigned = (state: string) => state === 'UNMATCHED' || state === 'CONFLICT';
    const ordered = [...requests].sort((a, b) => Number(unassigned(a.campaign_match_state)) - Number(unassigned(b.campaign_match_state)));
    for (const request of ordered) {
      const position: L.LatLngTuple = [request.location.latitude, request.location.longitude];
      const conflict = request.campaign_match_state === 'CONFLICT';
      const label = `${request.tracking_code}${request.priority ? ` · ${request.priority}` : ''}${conflict ? ' · trùng nhiều vùng' : ''}`;
      if (conflict) {
        L.circleMarker(position, { renderer: dotRenderer, radius: 15, color: '#dc2626', weight: 2, fillColor: '#dc2626', fillOpacity: 0.18, interactive: false }).addTo(layer);
      }
      const marker = L.circleMarker(position, {
        renderer: dotRenderer,
        radius: request.priority === 'P1' ? 10 : 6,
        color: '#ffffff',
        weight: 1.5,
        // Red: not attached to any campaign. Blue: attached to a campaign and still open.
        fillColor: unassigned(request.campaign_match_state) ? '#dc2626' : '#2563eb',
        fillOpacity: 0.95,
      })
        .bindTooltip(label)
        .on('click', () => selectRef.current?.(request.id))
        .addTo(layer);
      markersRef.current.set(request.id, marker);
      bounds.push(position);
    }
    boundsRef.current = bounds;
    map.invalidateSize();
    if (bounds.length && !focusedRef.current) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 12, animate: false });
  }, [requests, campaigns, hideId, expandingId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const selected = campaigns.find((campaign) => campaign.id === selectedCampaignId);
    if (!selected) {
      focusedRef.current = false;
      if (boundsRef.current.length) map.fitBounds(boundsRef.current, { padding: [24, 24], maxZoom: 12, animate: false });
      return;
    }
    focusedRef.current = true;
    map.invalidateSize();
    // Circle.getBounds() needs a circle already mounted on the map. Derive the
    // visible area from the center and diameter so selecting a campaign cannot
    // throw during React's effect phase.
    const bounds = L.latLng(selected.center.lat, selected.center.lng).toBounds(selected.radius_m * 2);
    map.stop();
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14, animate: false });
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [selectedCampaignId, campaigns]);

  const expansionNonce = expansion?.nonce;
  useEffect(() => {
    const map = mapRef.current;
    const layer = expansionLayerRef.current;
    if (!map || !layer || !expansion) return;
    layer.clearLayers();
    const index = campaigns.findIndex(campaign => campaign.id === expansion.id);
    const color = areaColor(Math.max(0, index));
    const circle = L.circle([expansion.center.lat, expansion.center.lng], {
      radius: expansion.fromRadiusM, color, weight: 3, fillColor: color, fillOpacity: 0.14,
      className: 'campaign-area-circle campaign-area-circle--expanding', interactive: false,
    }).addTo(layer);
    map.invalidateSize();
    map.stop();
    map.fitBounds(L.latLng(expansion.center.lat, expansion.center.lng).toBounds(expansion.toRadiusM * 2),
      { padding: [40, 40], maxZoom: 14, animate: false });
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      circle.setRadius(expansion.toRadiusM);
      expansionCompleteRef.current?.();
      return () => layer.clearLayers();
    }
    let frame = 0;
    let startedAt: number | null = null;
    const tick = (now: number) => {
      startedAt ??= now;
      const progress = Math.min(1, (now - startedAt) / 2200);
      const eased = 1 - (1 - progress) ** 3;
      circle.setRadius(expansion.fromRadiusM + (expansion.toRadiusM - expansion.fromRadiusM) * eased);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
      else expansionCompleteRef.current?.();
    };
    frame = window.requestAnimationFrame(tick);
    return () => { window.cancelAnimationFrame(frame); layer.clearLayers(); };
    // A new expansion command is the only reason to restart the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expansionNonce]);

  const focusNonce = focusRequestId?.nonce;
  const focusId = focusRequestId?.id;
  useEffect(() => {
    const map = mapRef.current;
    const marker = focusId ? markersRef.current.get(focusId) : undefined;
    if (!map || !marker) return;
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    map.invalidateSize();
    map.stop();
    const at = marker.getLatLng();
    map.flyTo(at, Math.max(map.getZoom(), 12), { duration: 0.8 });
    marker.bringToFront();
    marker.openTooltip();
    const ring = L.marker(at, {
      interactive: false, keyboard: false, zIndexOffset: 3000,
      icon: L.divIcon({ className: 'sos-focus-ring', html: '<span></span>', iconSize: [44, 44], iconAnchor: [22, 22] }),
    }).addTo(map);
    const timer = window.setTimeout(() => ring.remove(), 4500);
    return () => { window.clearTimeout(timer); ring.remove(); };
    // Triggered only by a new focus request (nonce), not by data refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce, focusId]);

  return (
    <>
      <div className="campaign-area-map-shell">
        <div
          ref={containerRef}
          className="campaign-area-map"
          role="region"
          aria-label={ariaLabel}
          style={{ height, width: '100%', borderRadius: 8 }}
        />
        <WeatherLayers map={mapInstance} />
        {overlay && <div className="campaign-area-map__tools">{overlay}</div>}
        {note && <p className="campaign-area-map__note">{note}</p>}
        {alert && <div className="campaign-area-map__alert">{alert}</div>}
        {expansion && <div className="campaign-area-map__expansion" role="status">
          Đang mở rộng {expansion.name}: {(expansion.fromRadiusM / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} → {(expansion.toRadiusM / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km
        </div>}
        {editActions && <div className="campaign-area-map__confirm" role="group" aria-label="Xác nhận thay đổi vùng chiến dịch">
          <span>Áp dụng vòng vừa chỉnh?</span>
          <button type="button" className="campaign-area-map__accept" aria-label="Xác nhận vùng mới" title="Xác nhận vùng mới"
            disabled={editActions.busy || !editActions.canConfirm} onClick={editActions.onConfirm}>✓</button>
          <button type="button" className="campaign-area-map__reject" aria-label="Bỏ thay đổi, về vòng ban đầu" title="Bỏ thay đổi, về vòng ban đầu"
            disabled={editActions.busy} onClick={editActions.onCancel}>✕</button>
        </div>}
      </div>
      {campaigns.length > 0 && (
        <ol className="campaign-area-legend" aria-label="Chú giải vùng chiến dịch">
          {campaigns.map((campaign, index) => (
            <li key={campaign.id}>
              <button type="button" className="campaign-area-legend__button" aria-pressed={selectedCampaignId === campaign.id}
                title={`${CAMPAIGN_STATUS_VI[campaign.status] ?? campaign.status} · bán kính ${(campaign.radius_m / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km`}
                onClick={() => onCampaignSelect?.(campaign.id)}>
                <span className="campaign-area-legend__badge" style={{ borderColor: areaColor(index), color: areaColor(index) }}>{index + 1}</span>
                <strong>{campaign.name}</strong>
                {campaign.status !== 'ACTIVE' && <span className="muted">{CAMPAIGN_STATUS_VI[campaign.status] ?? campaign.status}</span>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
