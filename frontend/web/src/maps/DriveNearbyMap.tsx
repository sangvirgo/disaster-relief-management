import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';

setWorkerUrl(workerUrl);

const tileUrl = (import.meta.env.VITE_OSM_TILE_URL as string | undefined)?.trim() || '';
const mapStyleUrl = (import.meta.env.VITE_OPENFREEMAP_STYLE_URL as string | undefined)?.trim() || 'https://tiles.openfreemap.org/styles/liberty';
const tileAttribution = (import.meta.env.VITE_OSM_TILE_ATTRIBUTION as string | undefined)?.trim() || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export type MapDrive = { id: string; title: string; warehouseName?: string; lat: number; lng: number; distanceM?: number | null; open: boolean };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] as string));
const distance = (meters: number) => meters < 1000 ? `${meters} m` : `${(meters / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km`;

/** Public map of donation drives (only warehouses that publish their location) plus the donor's own position. */
export function DriveNearbyMap({ drives, position, selectedId, onSelect }: {
  drives: MapDrive[]; position: { lat: number; lng: number } | null; selectedId?: string | null; onSelect: (driveId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { center: [16.1, 107.7], zoom: 6, zoomControl: false });
    L.control.zoom({ zoomInTitle: 'Phóng to', zoomOutTitle: 'Thu nhỏ' }).addTo(map);
    if (tileUrl) L.tileLayer(tileUrl, { attribution: tileAttribution, maxZoom: 19 }).addTo(map);
    else maplibreGL({ style: mapStyleUrl, locale: { 'Map.Title': 'Bản đồ' } }).addTo(map);
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    const timer = window.setTimeout(() => map.invalidateSize(), 250);
    return () => { window.clearTimeout(timer); map.remove(); mapRef.current = null; layerRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const group = L.featureGroup().addTo(layer);
    drives.forEach((drive, index) => {
      const selected = drive.id === selectedId;
      const color = drive.open ? '#2563eb' : '#94a3b8';
      L.marker([drive.lat, drive.lng], {
        zIndexOffset: selected ? 1000 : 0,
        icon: L.divIcon({
          className: 'campaign-area-label',
          html: `<span style="border-color:${color};color:${selected ? '#fff' : color};${selected ? `background:${color}` : ''}">${index + 1}</span>`,
          iconSize: [24, 24], iconAnchor: [12, 12],
        }),
      }).bindTooltip(`${escapeHtml(drive.title)}${drive.warehouseName ? ` · ${escapeHtml(drive.warehouseName)}` : ''}${typeof drive.distanceM === 'number' ? ` · cách ${distance(drive.distanceM)}` : ''}`)
        .on('click', () => selectRef.current(drive.id)).addTo(group);
    });
    if (position) {
      L.circleMarker([position.lat, position.lng], { radius: 8, color: '#fff', weight: 2, fillColor: '#dc2626', fillOpacity: 1 })
        .bindTooltip('Vị trí của bạn').addTo(group);
    }
    map.invalidateSize();
    const bounds = group.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 13, animate: false });
  }, [drives, position, selectedId]);

  return <div ref={containerRef} className="campaign-area-map donation-nearby-map" role="region" aria-label="Bản đồ các đợt quyên góp gần bạn" />;
}
