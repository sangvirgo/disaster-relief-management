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

const COLORS = ['#2563eb', '#059669', '#d97706', '#db2777', '#0891b2', '#65a30d', '#9333ea', '#dc2626'];
const colorAt = (index: number) => COLORS[index % COLORS.length]!;

export type MapCampaign = { id: string; name: string; status: string; lat: number; lng: number; radiusM: number };
export type MapDrive = { id: string; title: string; status: string; lat?: number; lng?: number };
export type Coverage = { id: string; index: number; name: string; lat: number; lng: number; radiusM: number | null; drives: MapDrive[] };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string
));
const kmLabel = (radiusM: number) => `${(radiusM / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km`;
const DRIVE_COLOR: Record<string, string> = { OPEN: '#16a34a', PAUSED: '#d97706', DRAFT: '#64748b' };
const DRIVE_LABEL: Record<string, string> = { OPEN: 'đang mở', PAUSED: 'tạm dừng', DRAFT: 'bản nháp' };
const PIN = 28;

/**
 * Map of every warehouse with its service radius. Donation drives appear as heart pins around their warehouse
 * (green open, amber paused, grey draft). Clicking a warehouse or a pin selects the warehouse.
 */
export function WarehouseCoverageMap({ rows, campaigns = [], loading = false, error = false, selectedId, onSelectWarehouse, onSelectDrive, toolbar, placing = false, onMapClick, banner }: {
  placing?: boolean; onMapClick?: (lat: number, lng: number) => void; banner?: React.ReactNode;
  rows: Coverage[]; campaigns?: MapCampaign[]; loading?: boolean; error?: boolean; selectedId?: string | null;
  onSelectWarehouse?: (warehouseId: string) => void; onSelectDrive?: (driveId: string, warehouseId: string) => void; toolbar?: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const selectWarehouseRef = useRef(onSelectWarehouse);
  selectWarehouseRef.current = onSelectWarehouse;
  const selectDriveRef = useRef(onSelectDrive);
  selectDriveRef.current = onSelectDrive;
  const mapClickRef = useRef(onMapClick);
  mapClickRef.current = onMapClick;
  const placingRef = useRef(placing);
  placingRef.current = placing;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { center: [16.1, 107.7], zoom: 6 });
    if (tileUrl) L.tileLayer(tileUrl, { attribution: tileAttribution, maxZoom: 19 }).addTo(map);
    else maplibreGL({ style: mapStyleUrl, locale: { 'Map.Title': 'Bản đồ' } }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    map.on('click', (event: L.LeafletMouseEvent) => { if (placingRef.current) mapClickRef.current?.(event.latlng.lat, event.latlng.lng); });
    const timer = window.setTimeout(() => map.invalidateSize(), 250);
    return () => { window.clearTimeout(timer); map.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const group = L.featureGroup().addTo(layer);
    // Relief campaign areas: dashed orange while ACTIVE, grey otherwise, so a warehouse's reach can be compared with the area it must serve.
    for (const campaign of campaigns) {
      const color = campaign.status === 'ACTIVE' ? '#ea580c' : '#6b7280';
      L.circle([campaign.lat, campaign.lng], {
        radius: campaign.radiusM, color, weight: 2, dashArray: '8 6', fillColor: color, fillOpacity: 0.04, interactive: false,
      }).addTo(group);
      L.marker([campaign.lat + campaign.radiusM / 111_320, campaign.lng], {
        zIndexOffset: 300,
        icon: L.divIcon({ className: 'campaign-flag-pin', html: `<span style="background:${color}" aria-hidden="true">⚑</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      }).bindTooltip(`Chiến dịch cứu trợ: ${escapeHtml(campaign.name)} (${campaign.status === 'ACTIVE' ? 'đang hoạt động' : campaign.status === 'PAUSED' ? 'tạm dừng' : 'đã đóng'}) · bán kính ${kmLabel(campaign.radiusM)}`).addTo(group);
    }
    for (const row of rows) {
      const color = colorAt(row.index);
      const selected = row.id === selectedId;
      if (row.radiusM) {
        L.circle([row.lat, row.lng], {
          radius: row.radiusM, color, weight: selected ? 4 : 2, fillColor: color, fillOpacity: selected ? 0.2 : 0.08, interactive: false,
        }).addTo(group);
      }
      L.marker([row.lat, row.lng], {
        zIndexOffset: selected ? 1000 : 500,
        icon: L.divIcon({
          className: 'campaign-area-label',
          html: `<span style="border-color:${color};color:${selected ? '#fff' : color};${selected ? `background:${color}` : ''}">${row.index + 1}</span>`,
          iconSize: [24, 24], iconAnchor: [12, 12],
        }),
      }).bindTooltip(`${escapeHtml(row.name)}${row.radiusM ? ` · bán kính ${kmLabel(row.radiusM)}` : ' · chưa khai báo bán kính'}`)
        .on('click', () => selectWarehouseRef.current?.(row.id)).addTo(group);
      // A drive with its own drop-off point is pinned there; one without falls back to a small ring around its warehouse.
      row.drives.forEach((drive, driveIndex) => {
        const pinColor = DRIVE_COLOR[drive.status] ?? '#64748b';
        const located = drive.lat !== undefined && drive.lng !== undefined;
        const angle = (driveIndex / Math.max(row.drives.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const dx = located ? 0 : Math.cos(angle) * 30;
        const dy = located ? 0 : Math.sin(angle) * 30;
        L.marker([located ? drive.lat! : row.lat, located ? drive.lng! : row.lng], {
          zIndexOffset: 800,
          icon: L.divIcon({
            className: 'warehouse-drive-pin',
            html: `<span style="background:${pinColor}" aria-hidden="true">♥</span>`,
            iconSize: [PIN, PIN], iconAnchor: [PIN / 2 - dx, PIN / 2 - dy],
          }),
        }).bindTooltip(`Điểm quyên góp: ${escapeHtml(drive.title)} (${DRIVE_LABEL[drive.status] ?? drive.status}) · ${escapeHtml(row.name)}`)
          .on('click', () => selectDriveRef.current?.(drive.id, row.id)).addTo(group);
      });
    }
    map.invalidateSize();
    const bounds = group.getBounds();
    if (rows.length && bounds.isValid()) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 13, animate: false });
  }, [rows, campaigns, selectedId]);

  useEffect(() => {
    const container = mapRef.current?.getContainer();
    if (container) container.style.cursor = placing ? 'crosshair' : '';
  }, [placing]);

  useEffect(() => {
    const map = mapRef.current;
    const row = rows.find((candidate) => candidate.id === selectedId);
    if (!map || !row) return;
    map.invalidateSize();
    map.stop();
    map.fitBounds(L.latLng(row.lat, row.lng).toBounds((row.radiusM ?? 2000) * 2), { padding: [48, 48], maxZoom: 14, animate: true });
  }, [selectedId, rows]);

  return <div className="warehouse-coverage__map-shell">
    <div ref={containerRef} className="campaign-area-map warehouse-coverage__map" role="region" aria-label="Bản đồ các kho, bán kính phục vụ và đợt quyên góp" />
    {banner && <div className="warehouse-map-banner" role="status">{banner}</div>}
    {toolbar && <div className="warehouse-map-toolbar">{toolbar}</div>}
    <div className="warehouse-map-legend" aria-label="Chú giải bản đồ">
      <span><i className="legend-dot legend-dot--warehouse">1</i> Kho và bán kính phục vụ</span>
      <span><i className="legend-dot legend-dot--campaign">⚑</i> Vùng chiến dịch cứu trợ</span>
      <span><i className="legend-dot legend-dot--open">♥</i> Đợt quyên góp đang mở</span>
      <span><i className="legend-dot legend-dot--paused">♥</i> Tạm dừng</span>
      <span><i className="legend-dot legend-dot--draft">♥</i> Bản nháp</span>
    </div>
    {loading && <p className="warehouse-coverage__overlay" role="status">Đang tải vị trí các kho…</p>}
    {error && <p className="warehouse-coverage__overlay warehouse-coverage__overlay--error" role="alert">Chưa tải được dữ liệu kho. Hãy bấm Cập nhật để thử lại.</p>}
    {!loading && !error && rows.length === 0 && <p className="warehouse-coverage__overlay">Chưa có kho nào có vị trí. Hãy thêm kho hoặc sửa kho để chọn vị trí.</p>}
  </div>;
}
