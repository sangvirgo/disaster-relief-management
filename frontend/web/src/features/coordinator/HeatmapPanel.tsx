import { useCallback, useEffect, useRef, useState } from 'react';
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

function resolutionForZoom(zoom: number): 250 | 500 | 1000 | 5000 {
  if (zoom >= 13) return 250;
  if (zoom >= 11) return 500;
  if (zoom >= 9) return 1000;
  return 5000;
}

function centerOf(cell: HeatmapCell): L.LatLngTuple | null {
  const [longitude, latitude] = cell.center.coordinates;
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    ? [latitude, longitude]
    : null;
}

function HeatmapCanvas({
  cells,
  selected,
  onResolutionChange,
}: {
  cells: HeatmapCell[];
  selected: SelectedSos | null;
  onResolutionChange: (resolution: 250 | 500 | 1000 | 5000) => void;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const dotLayerRef = useRef<L.LayerGroup | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    if (!elementRef.current) return;
    const map = L.map(elementRef.current, {
      center: [16.1, 107.7], zoom: 5, minZoom: 4, maxZoom: 18,
      zoomControl: true, scrollWheelZoom: true,
    });
    mapRef.current = map;
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
    dotLayerRef.current = L.layerGroup().addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);
    const canvas = document.createElement('canvas');
    canvas.className = 'heatmap-soft-layer';
    elementRef.current.appendChild(canvas);
    canvasRef.current = canvas;
    map.fitBounds([[8.2, 102.1], [23.5, 110.4]], { padding: [12, 12], animate: false });
    onResolutionChange(resolutionForZoom(map.getZoom()));
    const sizeTimer = window.setTimeout(() => map.invalidateSize(), 150);
    return () => {
      window.clearTimeout(sizeTimer);
      map.remove();
      canvas.remove();
      mapRef.current = null;
      dotLayerRef.current = null;
      markerLayerRef.current = null;
      canvasRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const dots = dotLayerRef.current;
    const canvas = canvasRef.current;
    if (!map || !dots || !canvas) return;
    function redraw() {
      if (!map || !dots || !canvas) return;
      const zoom = map.getZoom();
      onResolutionChange(resolutionForZoom(zoom));
      dots.clearLayers();
      const size = map.getSize();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(size.x * ratio));
      canvas.height = Math.max(1, Math.round(size.y * ratio));
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.scale(ratio, ratio);
      if (zoom <= 8) {
        const clusters: { latitude: number; longitude: number; x: number; y: number; count: number }[] = [];
        for (const cell of cells) {
          const position = centerOf(cell);
          if (!position) continue;
          const pixel = map.latLngToContainerPoint(position);
          const nearby = clusters.find((cluster) => Math.hypot(cluster.x - pixel.x, cluster.y - pixel.y) < 46);
          if (nearby) {
            const total = nearby.count + cell.count;
            nearby.latitude = (nearby.latitude * nearby.count + position[0] * cell.count) / total;
            nearby.longitude = (nearby.longitude * nearby.count + position[1] * cell.count) / total;
            nearby.x = (nearby.x * nearby.count + pixel.x * cell.count) / total;
            nearby.y = (nearby.y * nearby.count + pixel.y * cell.count) / total;
            nearby.count = total;
          } else {
            clusters.push({ latitude: position[0], longitude: position[1], x: pixel.x, y: pixel.y, count: cell.count });
          }
        }
        for (const cluster of clusters) {
          const radius = Math.min(24, 10 + Math.sqrt(cluster.count) * 3);
          const dot = L.circleMarker([cluster.latitude, cluster.longitude], {
            radius, color: '#fff', weight: 2.5,
            fillColor: cluster.count >= 5 ? '#bf2a22' : '#eb6b24', fillOpacity: 0.92,
            className: 'heatmap-overview-dot',
          }).addTo(dots);
          dot.bindTooltip(`${cluster.count} SOS gần khu vực này · nhấn để xem gần hơn`);
          dot.on('click', () => map.setView([cluster.latitude, cluster.longitude], 10, { animate: true }));
          L.marker([cluster.latitude, cluster.longitude], {
            interactive: false,
            icon: L.divIcon({
              className: 'heatmap-dot-count', html: String(cluster.count),
              iconSize: [radius * 2, radius * 2], iconAnchor: [radius, radius],
            }),
          }).addTo(dots);
        }
        return;
      }
      for (const cell of cells) {
        const position = centerOf(cell);
        if (!position) continue;
        const pixel = map.latLngToContainerPoint(position);
        const radius = zoom >= 14 ? 58 : zoom >= 11 ? 70 : 84;
        if (pixel.x < -radius || pixel.x > size.x + radius || pixel.y < -radius || pixel.y > size.y + radius) continue;
        const intensity = Math.min(1, 0.4 + Math.log2(cell.count + 1) * 0.18);
        const gradient = context.createRadialGradient(pixel.x, pixel.y, 2, pixel.x, pixel.y, radius);
        gradient.addColorStop(0, cell.count >= 4 ? `rgba(185, 28, 28, ${intensity})` : cell.count >= 2 ? `rgba(234, 88, 12, ${intensity})` : `rgba(245, 158, 11, ${intensity})`);
        gradient.addColorStop(0.38, `rgba(250, 174, 27, ${intensity * 0.55})`);
        gradient.addColorStop(0.75, `rgba(250, 204, 21, ${intensity * 0.22})`);
        gradient.addColorStop(1, 'rgba(250, 204, 21, 0)');
        context.fillStyle = gradient;
        context.fillRect(pixel.x - radius, pixel.y - radius, radius * 2, radius * 2);
      }
    }
    map.on('zoomend moveend resize', redraw);
    redraw();
    return () => { map.off('zoomend moveend resize', redraw); };
  }, [cells, onResolutionChange]);

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
        aria-label="Bản đồ nhiệt SOS; cuộn chuột hoặc dùng nút cộng trừ để phóng to và thu nhỏ" />
      {tileError && <p className="notice warning" role="status">
        Nền bản đồ chưa tải được. Dữ liệu SOS vẫn được hiển thị.
      </p>}
    </>
  );
}

export function HeatmapPanel({
  region,
  overviewRegions,
  selected = null,
  compact = false,
  showLayers = true,
}: {
  region: string;
  overviewRegions?: string[];
  selected?: SelectedSos | null;
  compact?: boolean;
  showLayers?: boolean;
}) {
  const [layer, setLayer] = useState<'confirmed' | 'unverified'>('unverified');
  const [resolution, setResolution] = useState<250 | 500 | 1000 | 5000>(5000);
  const [data, setData] = useState<{ items: HeatmapCell[]; generated_at: string } | null>(null);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(false);
  const targetRegions = overviewRegions?.length ? [...new Set(overviewRegions)] : region ? [region] : [];
  const regionKey = targetRegions.join('|');
  const onResolutionChange = useCallback((next: typeof resolution) => {
    setResolution((current) => current === next ? current : next);
  }, []);
  useEffect(() => {
    if (!regionKey) {
      setData(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    setWarning('');
    const now = new Date().toISOString();
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
    void Promise.allSettled(targetRegions.map((code) => {
      const params = new URLSearchParams({
        from, to: now, status_layer: layer, region_code: code, cell_m: String(resolution),
      });
      return api<HeatmapResult>('response', `/map/heatmap?${params}`);
    })).then((results) => {
      if (!active) return;
      const values = results.filter((result): result is PromiseFulfilledResult<HeatmapResult> => result.status === 'fulfilled');
      if (!values.length) {
        const first = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        setError(first?.reason instanceof Error ? first.reason.message : 'Không thể tải bản đồ nhiệt.');
        setData(null);
        return;
      }
      if (values.length < targetRegions.length)
        setWarning(`Chỉ tải được ${values.length}/${targetRegions.length} khu vực. Số SOS trên bản đồ chưa đầy đủ.`);
      setData({ items: values.flatMap((result) => result.value.items), generated_at: now });
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [regionKey, layer, resolution]);

  const count = data?.items.reduce((sum, cell) => sum + cell.count, 0) ?? 0;
  const showMap = Boolean(regionKey || validPoint(selected));

  return (
    <div className={`heatmap-panel${compact ? ' heatmap-panel-compact' : ''}`}>
      {showLayers && <div className="tabs heatmap-layer-tabs" role="group" aria-label="Lớp dữ liệu SOS">
        <button type="button" className={layer === 'confirmed' ? 'active' : ''}
          onClick={() => setLayer('confirmed')}>Đã xác minh</button>
        <button type="button" className={layer === 'unverified' ? 'active' : ''}
          onClick={() => setLayer('unverified')}>Chưa xác minh</button>
      </div>}
      {!showMap && <p>Chọn khu vực để xem bản đồ nhiệt.</p>}
      {showMap && <>
        {loading && <p role="status">Đang cập nhật bản đồ nhiệt…</p>}
        {error && <p className="notice error" role="alert">{error}</p>}
        {warning && <p className="notice warning" role="status">{warning}</p>}
        <HeatmapCanvas key={regionKey} cells={data?.items ?? []} selected={selected} onResolutionChange={onResolutionChange} />
        {data && <>
          <div className="heatmap-caption">
            <span>{resolution === 5000 ? 'Chấm SOS' : 'Vùng nhiệt'}</span>
            <span className="heatmap-gradient" aria-hidden="true" /><span>Ít → Nhiều</span>
            <small>{count} SOS · 7 ngày gần đây · độ chi tiết {resolution >= 1000 ? `${resolution / 1000} km` : `${resolution} m`}</small>
          </div>
          {compact && validPoint(selected) && <p className="muted">
            Ghim đỏ là SOS đang chọn. Nền nhiệt chỉ gồm SOS trong 7 ngày gần đây.
          </p>}
          {count === 0 && <p className="muted">
            Chưa có SOS thuộc lớp dữ liệu này trong khu vực và thời gian đã chọn.
          </p>}
          <p className="muted">Cập nhật: {timeLabel(data.generated_at)}</p>
        </>}
      </>}
    </div>
  );
}
