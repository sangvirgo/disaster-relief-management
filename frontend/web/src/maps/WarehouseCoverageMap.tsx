import { useEffect, useRef, useState } from 'react';
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
export type WarehouseDraft = { lat: number; lng: number; radiusM: number };
export type HoverTarget = { kind: 'warehouse' | 'drive'; id: string; warehouseId: string };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string
));
const kmLabel = (radiusM: number) => `${(radiusM / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km`;
const DRIVE_COLOR: Record<string, string> = { OPEN: '#16a34a', PAUSED: '#d97706', DRAFT: '#64748b' };
const PIN = 28;
const warehouseIconHtml = (selected = false) => `<svg class="${selected ? 'is-selected' : ''}" viewBox="0 0 64 64" aria-hidden="true"><rect class="warehouse-icon-bg" x="1" y="1" width="62" height="62" rx="9"/><g class="warehouse-icon-lines"><path d="M8 43V24L32 10l24 14v19M13 39V28h38v11M30 23h4M26 50V36h22v14"/><path d="M8 50V39h9v11M17 50V39h9v11M8 44h18M12.5 39v5M21.5 39v5"/><path d="M48 42h6l4 8v3H6v-3h42V42Z"/><circle class="warehouse-icon-wheel" cx="30" cy="53" r="3.5"/><circle class="warehouse-icon-wheel" cx="52" cy="53" r="3.5"/></g></svg>`;

/**
 * Map of every warehouse with its service radius. Donation drives appear as heart pins around their warehouse
 * (green open, amber paused, grey draft). Clicking a warehouse or a pin selects the warehouse.
 */
/** Places the warehouse editor card beside the draft pin (never on top of it), clamped inside the map. */
function draftCardStyle(point: { x: number; y: number; width: number; height: number }): React.CSSProperties {
  const width = Math.min(310, point.width - 20);
  const estimatedHeight = 300;
  if (point.width < 640) return { left: 10, right: 'auto', bottom: 10, top: 'auto', width: point.width - 20 };
  // The radius handle sits east of the pin, so prefer the west side to keep it reachable.
  const left = point.x - 40 - width >= 10 ? point.x - 40 - width : Math.min(point.width - width - 10, point.x + 40);
  const top = Math.max(10, Math.min(point.y - estimatedHeight / 2, point.height - estimatedHeight - 10));
  return { left, top, width, right: 'auto', bottom: 'auto' };
}

export function WarehouseCoverageMap({ rows, campaigns = [], loading = false, error = false, selectedId, onSelectWarehouse, onEditWarehouse, onSelectDrive, onHover, onEmptyClick, toolbar, hoverCard, placing = false, onMapClick, banner, creatingWarehouse = false, editingWarehouse = false, draft, onDraftChange }: {
  placing?: boolean; onMapClick?: (lat: number, lng: number) => void; banner?: React.ReactNode;
  rows: Coverage[]; campaigns?: MapCampaign[]; loading?: boolean; error?: boolean; selectedId?: string | null;
  onSelectWarehouse?: (warehouseId: string) => void; onEditWarehouse?: (warehouseId: string) => void; onSelectDrive?: (driveId: string, warehouseId: string) => void; onHover?: (target: HoverTarget) => void; onEmptyClick?: () => void;
  toolbar?: React.ReactNode; hoverCard?: React.ReactNode;
  creatingWarehouse?: boolean; editingWarehouse?: boolean; draft?: WarehouseDraft | null; onDraftChange?: (draft: WarehouseDraft) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const draftLayerRef = useRef<L.LayerGroup | null>(null);
  const selectWarehouseRef = useRef(onSelectWarehouse);
  selectWarehouseRef.current = onSelectWarehouse;
  const editWarehouseRef = useRef(onEditWarehouse);
  editWarehouseRef.current = onEditWarehouse;
  const selectDriveRef = useRef(onSelectDrive);
  selectDriveRef.current = onSelectDrive;
  const mapClickRef = useRef(onMapClick);
  mapClickRef.current = onMapClick;
  const placingRef = useRef(placing);
  placingRef.current = placing;
  const creatingRef = useRef(creatingWarehouse);
  creatingRef.current = creatingWarehouse;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const draftChangeRef = useRef(onDraftChange);
  draftChangeRef.current = onDraftChange;
  const hoverRef = useRef(onHover);
  hoverRef.current = onHover;
  const emptyClickRef = useRef(onEmptyClick);
  emptyClickRef.current = onEmptyClick;
  const [draftPoint, setDraftPoint] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [zoomComplete, setZoomComplete] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(6);
  const draftMoveToken = useRef(0);
  const selectionTimer = useRef<number | null>(null);

  const focusWarehouse = (map: L.Map, row: Coverage) => {
    map.invalidateSize();
    map.stop();
    const bounds = L.latLng(row.lat, row.lng).toBounds((row.radiusM ?? 1_000) * 2);
    map.fitBounds(bounds, { paddingTopLeft: [56, 56], paddingBottomRight: [56, map.getSize().y > 500 ? 190 : 56], maxZoom: 13, animate: false });
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { center: [16.1, 107.7], zoom: 6 });
    if (tileUrl) L.tileLayer(tileUrl, { attribution: tileAttribution, maxZoom: 19 }).addTo(map);
    else maplibreGL({ style: mapStyleUrl, locale: { 'Map.Title': 'Bản đồ' } }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    draftLayerRef.current = L.layerGroup().addTo(map);
    map.on('click', (event: L.LeafletMouseEvent) => {
      if (creatingRef.current) {
        const token = ++draftMoveToken.current;
        setZoomComplete(false);
        setDraftReady(false);
        map.stop();
        const radius = draftRef.current?.radiusM ?? 5000;
        draftChangeRef.current?.({ lat: event.latlng.lat, lng: event.latlng.lng, radiusM: radius });
        map.once('moveend', () => {
          if (token === draftMoveToken.current && creatingRef.current) {
            setZoomComplete(true);
            setDraftReady(true);
          }
        });
        map.flyTo(event.latlng, map.getSize().x < 450 ? 9 : 11, { duration: 0.55 });
      } else if (placingRef.current) mapClickRef.current?.(event.latlng.lat, event.latlng.lng);
      else emptyClickRef.current?.();
    });
    const updateDraftPoint = () => {
      const current = draftRef.current;
      if (!current) { setDraftPoint(null); return; }
      const point = map.latLngToContainerPoint([current.lat, current.lng]);
      const size = map.getSize();
      setDraftPoint({ x: point.x, y: point.y, width: size.x, height: size.y });
    };
    map.on('zoom move resize', updateDraftPoint);
    map.on('zoomend', () => setZoomLevel(map.getZoom()));
    const timer = window.setTimeout(() => map.invalidateSize(), 250);
    return () => { window.clearTimeout(timer); if (selectionTimer.current !== null) window.clearTimeout(selectionTimer.current); map.remove(); mapRef.current = null; layerRef.current = null; draftLayerRef.current = null; };
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
      const point = map.project([row.lat, row.lng], zoomLevel);
      const nearby = rows.filter((other) => map.project([other.lat, other.lng], zoomLevel).distanceTo(point) < 36).sort((a, b) => a.id.localeCompare(b.id));
      const place = nearby.findIndex((other) => other.id === row.id);
      const angle = nearby.length > 1 ? place * Math.PI * 2 / nearby.length - Math.PI / 2 : 0;
      const spread = nearby.length > 1 ? 34 + Math.min(nearby.length, 6) * 3 : 0;
      const iconAnchor: L.PointTuple = [22 - Math.cos(angle) * spread, 22 - Math.sin(angle) * spread];
      if (row.radiusM && !(editingWarehouse && selected)) {
        L.circle([row.lat, row.lng], {
          radius: row.radiusM, color, weight: selected ? 4 : 2, fillColor: color, fillOpacity: selected ? 0.2 : 0.08, interactive: false,
        }).addTo(group);
      }
      if (!(editingWarehouse && selected)) L.marker([row.lat, row.lng], {
        zIndexOffset: selected ? 1600 : 1200,
        icon: L.divIcon({
          className: 'warehouse-map-pin',
          html: warehouseIconHtml(selected),
          iconSize: [44, 44], iconAnchor,
        }),
      }).bindTooltip(escapeHtml(row.name)).on('mouseover', () => hoverRef.current?.({ kind: 'warehouse', id: row.id, warehouseId: row.id }))
        .on('click', (event: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(event.originalEvent);
          if (creatingRef.current || placingRef.current) { map.fire('click', { latlng: event.latlng }); return; }
          if (selectionTimer.current !== null) window.clearTimeout(selectionTimer.current);
          selectionTimer.current = window.setTimeout(() => {
            selectionTimer.current = null;
            focusWarehouse(map, row);
            selectWarehouseRef.current?.(row.id);
          }, 220);
        })
        .on('dblclick', (event: L.LeafletMouseEvent) => {
          if (selectionTimer.current !== null) window.clearTimeout(selectionTimer.current);
          selectionTimer.current = null;
          L.DomEvent.stop(event.originalEvent);
          if (creatingRef.current || placingRef.current) return;
          focusWarehouse(map, row);
          editWarehouseRef.current?.(row.id);
        }).addTo(group);
      // A drive with its own drop-off point is pinned there; one without falls back to a small ring around its warehouse.
      row.drives.forEach((drive, driveIndex) => {
        const pinColor = DRIVE_COLOR[drive.status] ?? '#64748b';
        const located = drive.lat !== undefined && drive.lng !== undefined;
        const angle = (driveIndex / Math.max(row.drives.length, 1)) * Math.PI * 2 - Math.PI / 2;
        const nearWarehouse = located && L.latLng(drive.lat!, drive.lng!).distanceTo([row.lat, row.lng]) < 2000;
        const dx = located && !nearWarehouse ? 0 : Math.cos(angle) * 40;
        const dy = located && !nearWarehouse ? 0 : Math.sin(angle) * 40;
        L.marker([located ? drive.lat! : row.lat, located ? drive.lng! : row.lng], {
          zIndexOffset: 800,
          icon: L.divIcon({
            className: 'warehouse-drive-pin',
            html: `<span style="background:${pinColor}" aria-hidden="true">♥</span>`,
            iconSize: [PIN, PIN], iconAnchor: [PIN / 2 - dx, PIN / 2 - dy],
          }),
        }).on('mouseover', () => hoverRef.current?.({ kind: 'drive', id: drive.id, warehouseId: row.id }))
          .on('click', (event: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(event.originalEvent);
            if (creatingRef.current || placingRef.current) map.fire('click', { latlng: event.latlng });
            else selectDriveRef.current?.(drive.id, row.id);
          }).addTo(group);
      });
    }
    map.invalidateSize();
  }, [rows, campaigns, selectedId, editingWarehouse, creatingWarehouse, placing, zoomLevel]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !rows.length || selectedId || creatingWarehouse || editingWarehouse) return;
    const bounds = L.latLngBounds(rows.map(row => [row.lat, row.lng] as L.LatLngTuple));
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [80, 80], maxZoom: 9, animate: false });
  }, [rows, creatingWarehouse, editingWarehouse]);

  useEffect(() => {
    const container = mapRef.current?.getContainer();
    if (container) container.style.cursor = placing || creatingWarehouse ? 'crosshair' : '';
  }, [placing, creatingWarehouse]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = draftLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if ((!creatingWarehouse && !editingWarehouse) || !draft || !zoomComplete) return;
    const circle = L.circle([draft.lat, draft.lng], { radius: draft.radiusM, color: '#1d4ed8', weight: 3, fillColor: '#3b82f6', fillOpacity: 0.12, dashArray: '8 5', interactive: false }).addTo(layer);
    const center = L.marker([draft.lat, draft.lng], { draggable: true, autoPan: true, icon: L.divIcon({ className: 'warehouse-draft-pin warehouse-map-pin', html: warehouseIconHtml(true), iconSize: [44, 44], iconAnchor: [22, 22] }) }).addTo(layer);
    const radiusLng = (lat: number, lng: number, radius: number) => lng + radius / (111_320 * Math.max(0.1, Math.cos(lat * Math.PI / 180)));
    const handleLng = radiusLng(draft.lat, draft.lng, draft.radiusM);
    const handle = L.marker([draft.lat, handleLng], { draggable: true, autoPan: true, icon: L.divIcon({ className: 'warehouse-radius-handle', html: '<span aria-hidden="true">↔</span>', iconSize: [32, 32], iconAnchor: [16, 16] }) }).addTo(layer);
    center.on('drag', () => {
      const point = center.getLatLng();
      circle.setLatLng(point);
      handle.setLatLng([point.lat, radiusLng(point.lat, point.lng, circle.getRadius())]);
      const screen = map.latLngToContainerPoint(point);
      const size = map.getSize();
      setDraftPoint({ x: screen.x, y: screen.y, width: size.x, height: size.y });
    });
    center.on('dragstart', () => setDraftReady(false));
    center.on('dragend', () => { const point = center.getLatLng(); draftChangeRef.current?.({ ...draft, lat: point.lat, lng: point.lng }); setDraftReady(true); });
    handle.on('drag', () => circle.setRadius(Math.min(200_000, Math.max(500, map.distance(center.getLatLng(), handle.getLatLng())))));
    handle.on('dragstart', () => setDraftReady(false));
    handle.on('dragend', () => { draftChangeRef.current?.({ ...draft, radiusM: Math.round(circle.getRadius()) }); setDraftReady(true); });
    const point = map.latLngToContainerPoint([draft.lat, draft.lng]);
    const size = map.getSize();
    setDraftPoint({ x: point.x, y: point.y, width: size.x, height: size.y });
  }, [creatingWarehouse, editingWarehouse, draft, zoomComplete]);

  useEffect(() => {
    if (creatingWarehouse) {
      ++draftMoveToken.current;
      setZoomComplete(false);
      setDraftReady(false);
      mapRef.current?.stop();
      mapRef.current?.setView([16.1, 107.7], 6, { animate: false });
    } else { setZoomComplete(false); setDraftReady(false); }
  }, [creatingWarehouse]);

  useEffect(() => {
    if (editingWarehouse) { setZoomComplete(true); setDraftReady(true); }
    else if (!creatingWarehouse) { setZoomComplete(false); setDraftReady(false); }
  }, [editingWarehouse]);

  useEffect(() => {
    const map = mapRef.current;
    const row = rows.find((candidate) => candidate.id === selectedId);
    if (!map || !row || editingWarehouse) return;
    focusWarehouse(map, row);
  }, [selectedId, rows, editingWarehouse]);

  return <div className="warehouse-coverage__map-shell">
    <div ref={containerRef} className="campaign-area-map warehouse-coverage__map" role="region" aria-label="Bản đồ các kho, bán kính phục vụ và đợt quyên góp" />
    {banner && <div className="warehouse-map-banner" role="status">{banner}</div>}
    {(creatingWarehouse || editingWarehouse) && draft && zoomComplete && !draftReady && <div className="warehouse-map-banner" role="status">Kéo tâm kho hoặc nút bán kính, rồi thả để tiếp tục.</div>}
    {toolbar && <div className="warehouse-map-toolbar">{toolbar}</div>}
    {hoverCard && ((!creatingWarehouse && !editingWarehouse) || (creatingWarehouse && !draft) || draftReady) && <div className={`warehouse-map-hover${creatingWarehouse || editingWarehouse ? ' warehouse-map-hover--draft' : ''}`} style={(creatingWarehouse || editingWarehouse) && draftPoint ? draftCardStyle(draftPoint) : undefined}>{hoverCard}</div>}
    <div className="warehouse-map-legend" aria-label="Chú giải bản đồ">
      <span><span className="legend-warehouse-icon" dangerouslySetInnerHTML={{ __html: warehouseIconHtml() }} /> Kho và bán kính phục vụ</span>
      <span><i className="legend-dot legend-dot--campaign">⚑</i> Vùng chiến dịch cứu trợ</span>
      <span><i className="legend-dot legend-dot--open">♥</i> Đợt quyên góp đang mở</span>
      <span><i className="legend-dot legend-dot--paused">♥</i> Tạm dừng</span>
      <span><i className="legend-dot legend-dot--draft">♥</i> Bản nháp</span>
    </div>
    {loading && <p className="warehouse-coverage__overlay" role="status">Đang tải vị trí các kho…</p>}
    {error && <p className="warehouse-coverage__overlay warehouse-coverage__overlay--error" role="alert">Chưa tải được dữ liệu kho. Hãy bấm Làm mới để thử lại.</p>}
    {!loading && !error && rows.length === 0 && <p className="warehouse-coverage__overlay">Chưa có kho nào có vị trí. Hãy thêm kho hoặc sửa kho để chọn vị trí.</p>}
  </div>;
}
