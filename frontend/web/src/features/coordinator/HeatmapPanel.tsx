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

const heatColors = [
  { at: 0, rgb: [250, 204, 21] },
  { at: 0.25, rgb: [249, 115, 22] },
  { at: 0.5, rgb: [239, 68, 68] },
  { at: 0.75, rgb: [220, 38, 38] },
  { at: 1, rgb: [127, 29, 29] },
];

const cellPinIcon = L.divIcon({
  className: 'heatmap-pin heatmap-pin-cell',
  html: '<span class="heatmap-pin-figure" aria-hidden="true"><svg viewBox="0 0 32 44"><path d="M16 1C7.7 1 1 7.7 1 16c0 11 15 26 15 26s15-15 15-26C31 7.7 24.3 1 16 1Z" fill="#b42318" stroke="#fff" stroke-width="2"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg></span>',
  iconSize: [24, 34], iconAnchor: [12, 34],
});

const selectedPinIcon = L.divIcon({
  className: 'heatmap-pin heatmap-pin-selected',
  html: '<span class="heatmap-pin-figure" aria-hidden="true"><svg viewBox="0 0 32 44"><path d="M16 1C7.7 1 1 7.7 1 16c0 11 15 26 15 26s15-15 15-26C31 7.7 24.3 1 16 1Z" fill="#e11d2e" stroke="#fff" stroke-width="2"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg></span>',
  iconSize: [36, 48], iconAnchor: [18, 48],
});

function cellPopup(count: number, resolution: number, cells = 1): HTMLElement {
  const content = document.createElement('div');
  const title = document.createElement('strong');
  title.textContent = cells === 1
    ? `${count} SOS trong ô ${resolution} m`
    : `${count} SOS trong ${cells} ô gần nhau`;
  const explanation = document.createElement('span');
  explanation.textContent = 'Ghim nằm ở tâm ô tổng hợp, không phải vị trí chính xác của từng SOS.';
  content.append(title, explanation);
  return content;
}

function HeatmapCanvas({
  cells,
  selected,
  onResolutionChange,
  onZoomChange,
  heatOpacity,
}: {
  cells: HeatmapCell[];
  selected: SelectedSos | null;
  onResolutionChange: (resolution: 250 | 500 | 1000 | 5000) => void;
  onZoomChange: (zoom: number) => void;
  heatOpacity: number;
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
    if (canvasRef.current) canvasRef.current.style.opacity = String(heatOpacity / 100);
  }, [heatOpacity]);

  useEffect(() => {
    const map = mapRef.current;
    const dots = dotLayerRef.current;
    const canvas = canvasRef.current;
    if (!map || !dots || !canvas) return;
    function redraw() {
      if (!map || !dots || !canvas) return;
      const zoom = map.getZoom();
      onResolutionChange(resolutionForZoom(zoom));
      onZoomChange(zoom);
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
      if (zoom <= 10) {
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
            radius, color: '#fff', weight: 3,
            fillColor: '#c2410c', fillOpacity: 0.98,
            className: 'heatmap-overview-dot',
          }).addTo(dots);
          dot.bindTooltip(`${cluster.count} SOS trong cụm hiển thị · nhấn để xem mật độ`);
          dot.on('click', () => map.setView(
            [cluster.latitude, cluster.longitude], map.getZoom() < 8 ? 8 : 12, { animate: true }
          ));
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
      const field = document.createElement('canvas');
      const step = 3;
      field.width = Math.max(1, Math.ceil(size.x / step));
      field.height = Math.max(1, Math.ceil(size.y / step));
      const fieldContext = field.getContext('2d');
      if (!fieldContext) return;
      const densityField = new Float32Array(field.width * field.height);
      const influenceMeters = 1000;
      for (const cell of cells) {
        const position = centerOf(cell);
        if (!position) continue;
        const pixel = map.latLngToContainerPoint(position);
        const longitudeOffset = influenceMeters / (111_320 * Math.cos(position[0] * Math.PI / 180));
        const radius = Math.abs(map.latLngToContainerPoint([position[0], position[1] + longitudeOffset]).x - pixel.x);
        if (radius <= 0 || pixel.x < -radius || pixel.x > size.x + radius || pixel.y < -radius || pixel.y > size.y + radius) continue;
        const centerX = pixel.x / step;
        const centerY = pixel.y / step;
        const radiusInField = radius / step;
        const radiusSquared = radiusInField * radiusInField;
        const minX = Math.max(0, Math.floor(centerX - radiusInField));
        const maxX = Math.min(field.width - 1, Math.ceil(centerX + radiusInField));
        const minY = Math.max(0, Math.floor(centerY - radiusInField));
        const maxY = Math.min(field.height - 1, Math.ceil(centerY + radiusInField));
        for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
          const distanceSquared = (x - centerX) ** 2 + (y - centerY) ** 2;
          if (distanceSquared >= radiusSquared) continue;
          const influence = 1 - distanceSquared / radiusSquared;
          densityField[y * field.width + x] += cell.count * influence * influence;
        }
      }
      const image = fieldContext.createImageData(field.width, field.height);
      const pixels = image.data;
      for (let fieldIndex = 0; fieldIndex < densityField.length; fieldIndex++) {
        const density = Math.min(1, densityField[fieldIndex] / 4);
        if (density <= 0) continue;
        const index = fieldIndex * 4;
        let upper = 1;
        while (upper < heatColors.length - 1 && heatColors[upper].at < density) upper++;
        const low = heatColors[upper - 1];
        const high = heatColors[upper];
        const fraction = (density - low.at) / (high.at - low.at);
        for (let channel = 0; channel < 3; channel++)
          pixels[index + channel] = Math.round(low.rgb[channel] + (high.rgb[channel] - low.rgb[channel]) * fraction);
        pixels[index + 3] = Math.round(175 * Math.pow(density, 0.25));
      }
      fieldContext.putImageData(image, 0, 0);
      context.imageSmoothingEnabled = true;
      context.drawImage(field, 0, 0, size.x, size.y);
      if (zoom >= 12) {
        const bounds = map.getBounds().pad(0.1);
        const minSeparation = zoom >= 15 ? 20 : zoom >= 14 ? 27 : 36;
        const pinClusters: { position: L.LatLngTuple; x: number; y: number; count: number; cells: number }[] = [];
        for (const cell of cells) {
          const position = centerOf(cell);
          if (!position || !bounds.contains(position)) continue;
          const pixel = map.latLngToContainerPoint(position);
          const nearby = pinClusters.find((pin) => Math.hypot(pin.x - pixel.x, pin.y - pixel.y) < minSeparation);
          if (nearby) {
            const total = nearby.count + cell.count;
            nearby.position = [
              (nearby.position[0] * nearby.count + position[0] * cell.count) / total,
              (nearby.position[1] * nearby.count + position[1] * cell.count) / total,
            ];
            nearby.x = (nearby.x * nearby.count + pixel.x * cell.count) / total;
            nearby.y = (nearby.y * nearby.count + pixel.y * cell.count) / total;
            nearby.count = total;
            nearby.cells++;
          } else {
            pinClusters.push({ position, x: pixel.x, y: pixel.y, count: cell.count, cells: 1 });
          }
        }
        for (const pin of pinClusters) {
          L.marker(pin.position, { icon: cellPinIcon, zIndexOffset: 100 })
            .bindPopup(cellPopup(pin.count, resolutionForZoom(zoom), pin.cells), { className: 'heatmap-cell-popup' })
            .addTo(dots);
        }
      }
    }
    function showCellCount(event: L.LeafletMouseEvent) {
      if (!map || map.getZoom() <= 10) return;
      const clicked = map.latLngToContainerPoint(event.latlng);
      let nearest: { position: L.LatLngTuple; count: number; distance: number } | null = null;
      for (const cell of cells) {
        const position = centerOf(cell);
        if (!position) continue;
        const pixel = map.latLngToContainerPoint(position);
        const distance = Math.hypot(clicked.x - pixel.x, clicked.y - pixel.y);
        if (!nearest || distance < nearest.distance) nearest = { position, count: cell.count, distance };
      }
      if (!nearest || nearest.distance > 40) return;
      L.popup({ className: 'heatmap-cell-popup' }).setLatLng(nearest.position)
        .setContent(cellPopup(nearest.count, resolutionForZoom(map.getZoom()))).openOn(map);
    }
    map.on('zoomend moveend resize', redraw);
    map.on('click', showCellCount);
    redraw();
    return () => {
      map.off('zoomend moveend resize', redraw);
      map.off('click', showCellCount);
    };
  }, [cells, onResolutionChange, onZoomChange]);

  useEffect(() => {
    const map = mapRef.current;
    const markerLayer = markerLayerRef.current;
    if (!map || !markerLayer) return;
    markerLayer.clearLayers();
    if (!validPoint(selected)) return;
    const position: L.LatLngTuple = [selected.latitude, selected.longitude];
    const label = document.createElement('span');
    label.textContent = `SOS ${selected.trackingCode}`;
    L.marker(position, { icon: selectedPinIcon, zIndexOffset: 1000 })
      .bindTooltip(label)
      .addTo(markerLayer);
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
  const [zoom, setZoom] = useState(5);
  const [heatOpacity, setHeatOpacity] = useState(55);
  const [data, setData] = useState<{ items: HeatmapCell[]; generated_at: string } | null>(null);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const targetRegions = overviewRegions?.length ? [...new Set(overviewRegions)] : region ? [region] : [];
  const regionKey = targetRegions.join('|');
  const onResolutionChange = useCallback((next: typeof resolution) => {
    setResolution((current) => current === next ? current : next);
  }, []);
  const onZoomChange = useCallback((next: number) => {
    setZoom((current) => current === next ? current : next);
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
  }, [regionKey, layer, resolution, refresh]);

  useEffect(() => {
    if (!regionKey) return;
    const timer = window.setInterval(() => setRefresh((value) => value + 1), 45_000);
    return () => window.clearInterval(timer);
  }, [regionKey]);

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
      {showMap && <button type="button" className="button secondary heatmap-refresh" disabled={loading}
        onClick={() => setRefresh((value) => value + 1)}>Cập nhật SOS trên bản đồ</button>}
      {!showMap && <p>Chọn khu vực để xem bản đồ nhiệt.</p>}
      {showMap && <>
        {loading && <p role="status">Đang cập nhật bản đồ nhiệt…</p>}
        {error && <p className="notice error" role="alert">{error}</p>}
        {warning && <p className="notice warning" role="status">{warning}</p>}
        <HeatmapCanvas key={regionKey} cells={data?.items ?? []} selected={selected} onResolutionChange={onResolutionChange} onZoomChange={onZoomChange} heatOpacity={heatOpacity} />
        {data && <>
          {zoom > 10 && <label className="heatmap-opacity-control">
            <span>Độ đậm vùng nhiệt</span>
            <input type="range" min="0" max="100" step="5" value={heatOpacity}
              onChange={(event) => setHeatOpacity(Number(event.target.value))} />
            <output>{heatOpacity}%</output>
          </label>}
          <div className="heatmap-caption">
            {zoom <= 10 ? <span>Số trên chấm là tổng SOS trong cụm. Nhấn chấm để xem mật độ.</span> : <>
              <span>Mật độ SOS</span>
              <span className="heatmap-gradient" aria-hidden="true" /><span>Ít → Nhiều</span>
            </>}
            <small>{count} SOS · 7 ngày gần đây · độ chi tiết {resolution >= 1000 ? `${resolution / 1000} km` : `${resolution} m`}</small>
          </div>
          {zoom > 10 && <p className="muted">Vùng không có SOS giữ nguyên nền bản đồ. Ghim đỏ đại diện cho ô có SOS; nhấn ghim để xem số yêu cầu. Mật độ được tính trong phạm vi 1 km quanh ô.</p>}
          {compact && validPoint(selected) && <p className="muted">
            Ghim đỏ đang nhảy là SOS đang chọn, đặt theo tọa độ trong hồ sơ. Nền nhiệt chỉ gồm SOS trong 7 ngày gần đây.
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
