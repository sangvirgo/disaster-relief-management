import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api } from '../../api/client';
import type { components } from '../../api/generated/response';
import { timeLabel } from '../../i18n/labels';

setWorkerUrl(workerUrl);

type HeatmapResult = components['schemas']['HeatmapResult'];
type HeatmapCell = components['schemas']['HeatmapCell'];
export type SelectedSos = {
  id: string;
  trackingCode: string;
  longitude: number;
  latitude: number;
};

const tileUrl = (import.meta.env.VITE_OSM_TILE_URL as string | undefined)?.trim() || '';
const tileAttribution =
  (import.meta.env.VITE_OSM_TILE_ATTRIBUTION as string | undefined)?.trim() ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const mapStyleUrl =
  (import.meta.env.VITE_OPENFREEMAP_STYLE_URL as string | undefined)?.trim() ||
  'https://tiles.openfreemap.org/styles/liberty';

function validPoint(point: SelectedSos | null): point is SelectedSos {
  return Boolean(
    point && Number.isFinite(point.longitude) && Number.isFinite(point.latitude) &&
    Math.abs(point.longitude) <= 180 && Math.abs(point.latitude) <= 90
  );
}

function cellColor(count: number): string {
  if (count >= 7) return '#b42318';
  if (count >= 4) return '#ea580c';
  if (count >= 2) return '#f59e0b';
  return '#facc15';
}

function HeatmapCanvas({
  cells,
  selected,
}: {
  cells: HeatmapCell[];
  selected: SelectedSos | null;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const cellLayerRef = useRef<L.LayerGroup | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const framedRef = useRef(false);
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    if (!elementRef.current) return;
    const map = L.map(elementRef.current, {
      center: [16.1, 107.7], zoom: 6, zoomControl: true, scrollWheelZoom: true,
    });
    mapRef.current = map;
    cellLayerRef.current = L.layerGroup().addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);
    if (tileUrl) {
      L.tileLayer(tileUrl, { attribution: tileAttribution, maxZoom: 19 })
        .on('tileerror', () => setTileError(true))
        .on('tileload', () => setTileError(false))
        .addTo(map);
    } else {
      const vectorLayer = maplibreGL({ style: mapStyleUrl }).addTo(map);
      vectorLayer.getMaplibreMap().on('error', () => setTileError(true));
      vectorLayer.getMaplibreMap().on('load', () => setTileError(false));
    }
    const sizeTimer = window.setTimeout(() => map.invalidateSize(), 150);
    return () => {
      window.clearTimeout(sizeTimer);
      map.remove();
      mapRef.current = null;
      cellLayerRef.current = null;
      markerLayerRef.current = null;
      framedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const cellLayer = cellLayerRef.current;
    if (!map || !cellLayer) return;
    cellLayer.clearLayers();
    const bounds = L.latLngBounds([]);
    const selectedLatLng = validPoint(selected)
      ? L.latLng(selected.latitude, selected.longitude)
      : null;
    for (const cell of cells) {
      const ring = cell.cell.coordinates[0];
      if (!ring || ring.length < 4) continue;
      const polygon = L.polygon(
        ring.map(([longitude, latitude]) => [latitude, longitude] as L.LatLngTuple),
        {
          color: '#fff', weight: 1.5, fillColor: cellColor(cell.count),
          fillOpacity: 0.62, className: 'heatmap-cell-polygon',
        }
      );
      if (selectedLatLng && polygon.getBounds().contains(selectedLatLng)) {
        polygon.setStyle({ color: '#9f1239', weight: 3, fillOpacity: 0.75 });
      }
      polygon.bindTooltip(`${cell.count} yêu cầu SOS trong ô này`);
      polygon.addTo(cellLayer);
      bounds.extend(polygon.getBounds());
    }
    if (!framedRef.current && !selectedLatLng && bounds.isValid()) {
      map.fitBounds(bounds.pad(0.28), { maxZoom: 13, animate: false });
      framedRef.current = true;
    }
    map.invalidateSize();
  }, [cells, selected?.id, selected?.latitude, selected?.longitude]);

  useEffect(() => {
    const map = mapRef.current;
    const markerLayer = markerLayerRef.current;
    if (!map || !markerLayer) return;
    markerLayer.clearLayers();
    if (!validPoint(selected)) return;
    const position: L.LatLngTuple = [selected.latitude, selected.longitude];
    L.circleMarker(position, {
      radius: 20, color: '#be123c', weight: 2, fillColor: '#fb7185', fillOpacity: 0.24,
      className: 'heatmap-sos-halo',
    }).addTo(markerLayer);
    L.circleMarker(position, {
      radius: 8, color: '#fff', weight: 3, fillColor: '#be123c', fillOpacity: 1,
    }).bindTooltip(`SOS ${selected.trackingCode}`).addTo(markerLayer);
    map.setView(position, Math.max(map.getZoom(), 14), { animate: false });
    map.invalidateSize();
  }, [selected?.id, selected?.latitude, selected?.longitude]);

  return (
    <>
      <div ref={elementRef} className="heatmap-canvas" role="region"
        aria-label="Bản đồ nhiệt SOS; dùng nút cộng trừ để phóng to hoặc thu nhỏ" />
      {tileError && <p className="notice warning" role="status">
        Nền bản đồ chưa tải được. Dữ liệu các ô SOS vẫn được hiển thị.
      </p>}
    </>
  );
}

export function HeatmapPanel({
  region,
  selected = null,
  compact = false,
  showLayers = true,
}: {
  region: string;
  selected?: SelectedSos | null;
  compact?: boolean;
  showLayers?: boolean;
}) {
  const [layer, setLayer] = useState<'confirmed' | 'unverified'>('confirmed');
  const [data, setData] = useState<HeatmapResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!region) {
      setData(null);
      return;
    }
    let active = true;
    setLoading(true);
    setData(null);
    setError('');
    const now = new Date().toISOString();
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const params = new URLSearchParams({
      from, to: now, status_layer: layer, region_code: region, cell_m: '1000',
    });
    void api<HeatmapResult>('response', `/map/heatmap?${params}`)
      .then((value) => { if (active) setData(value); })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Không thể tải bản đồ nhiệt.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [region, layer]);

  return (
    <div className={`heatmap-panel${compact ? ' heatmap-panel-compact' : ''}`}>
      {showLayers && <div className="tabs heatmap-layer-tabs" role="group" aria-label="Lớp dữ liệu SOS">
        <button type="button" className={layer === 'confirmed' ? 'active' : ''}
          onClick={() => setLayer('confirmed')}>Đã xác minh</button>
        <button type="button" className={layer === 'unverified' ? 'active' : ''}
          onClick={() => setLayer('unverified')}>Chưa xác minh</button>
      </div>}
      {!region && <p>Chọn khu vực để xem bản đồ nhiệt.</p>}
      {!region && validPoint(selected) && <HeatmapCanvas cells={[]} selected={selected} />}
      {region && <>
        {loading && <p role="status">Đang cập nhật bản đồ nhiệt…</p>}
        {error && <p className="notice error" role="alert">{error}</p>}
        {data && <>
          <HeatmapCanvas key={region} cells={data.items} selected={selected} />
          <div className="heatmap-caption">
            <span>Ít SOS</span><span className="heatmap-gradient" aria-hidden="true" /><span>Nhiều SOS</span>
            <small>{data.items.reduce((sum, cell) => sum + cell.count, 0)} yêu cầu · 7 ngày gần đây · ô 1 km</small>
          </div>
          {compact && validPoint(selected) && <p className="muted">
            Ghim đỏ là SOS đang chọn. Nền màu chỉ tính yêu cầu trong 7 ngày gần đây;
            SOS cũ vẫn hiện ghim nhưng có thể không nằm trong ô màu.
          </p>}
          {data.items.length === 0 && <p className="muted">
            Chưa có SOS thuộc lớp dữ liệu này trong khu vực và thời gian đã chọn.
          </p>}
          <p className="muted">Cập nhật: {timeLabel(data.generated_at)}</p>
        </>}
      </>}
    </div>
  );
}
