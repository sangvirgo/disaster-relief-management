import { useEffect, useState } from 'react';
import L from 'leaflet';
import './weather-layers.css';
import {
  TEMP_STOPS, WIND_STOPS, WeatherField, rampCss,
  type FieldMode, type Grid, type GridPoint,
} from './weatherField';

/**
 * Free, key-less weather overlays for a Leaflet map (Windy-style):
 *  - rain radar      RainViewer
 *  - cloud satellite NASA GIBS (Himawari-9 infrared)
 *  - wind / temperature colour field + wind particles  Open-Meteo
 *  - tropical cyclones (position, track, wind radii)  GDACS
 * All sources are called straight from the browser (CORS enabled) and allowed in the nginx CSP.
 */

type LayerKey = 'rain' | 'cloud' | 'wind' | 'temp' | 'storm';
type Status = 'idle' | 'loading' | 'ready' | 'error';

const LAYERS: { key: LayerKey; icon: string; label: string }[] = [
  { key: 'rain', icon: '🌧', label: 'Radar mưa' },
  { key: 'cloud', icon: '☁️', label: 'Mây vệ tinh' },
  { key: 'wind', icon: '💨', label: 'Gió' },
  { key: 'temp', icon: '🌡', label: 'Nhiệt độ' },
  { key: 'storm', icon: '🌀', label: 'Bão' },
];

const GRID_COLS = 8;
const GRID_ROWS = 6;
const MIN_GRID_ZOOM = 4;
const GRID_TTL_MS = 10 * 60 * 1000;

type Storm = {
  id: string;
  name: string;
  alert: 'Green' | 'Orange' | 'Red';
  maxWindKmh: number | null;
  country: string;
  center: L.LatLngTuple | null;
  layer: L.LayerGroup;
};

const ALERT_COLOR = { Green: '#2e9e5b', Orange: '#f08c00', Red: '#d62828' } as const;
const ALERT_LABEL = { Green: 'Cảnh báo thấp', Orange: 'Cảnh báo trung bình', Red: 'Cảnh báo cao' } as const;

function ensurePane(map: L.Map, name: string, zIndex: number, interactive = false) {
  const pane = map.getPane(name) ?? map.createPane(name);
  pane.style.zIndex = String(zIndex);
  pane.style.pointerEvents = interactive ? 'auto' : 'none';
  return pane;
}

function gridPoints(map: L.Map) {
  const b = map.getBounds();
  const south = Math.max(b.getSouth(), -80);
  const north = Math.min(b.getNorth(), 80);
  const west = Math.max(b.getWest(), -180);
  const east = Math.min(b.getEast(), 180);
  const lats = Array.from({ length: GRID_ROWS }, (_, r) => Math.round((south + ((r + 0.5) / GRID_ROWS) * (north - south)) * 100) / 100);
  const lons = Array.from({ length: GRID_COLS }, (_, c) => Math.round((west + ((c + 0.5) / GRID_COLS) * (east - west)) * 100) / 100);
  return { lats, lons };
}

const gridCache = new Map<string, { at: number; grid: Grid }>();

async function fetchGrid(map: L.Map, signal: AbortSignal): Promise<Grid> {
  const { lats, lons } = gridPoints(map);
  const key = `${lats[0]}|${lats.at(-1)}|${lons[0]}|${lons.at(-1)}`;
  const hit = gridCache.get(key);
  if (hit && Date.now() - hit.at < GRID_TTL_MS) return hit.grid;

  const pts = lats.flatMap((lat) => lons.map((lon) => ({ lat, lon })));
  const params = new URLSearchParams({
    latitude: pts.map((p) => p.lat).join(','),
    longitude: pts.map((p) => p.lon).join(','),
    current: 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl',
    wind_speed_unit: 'kmh',
    timezone: 'GMT',
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal });
  if (!response.ok) throw new Error('grid');
  const body = (await response.json()) as unknown;
  const list = Array.isArray(body) ? body : [body];
  if (list.length !== pts.length) throw new Error('grid');
  const rows: GridPoint[][] = lats.map(() => []);
  list.forEach((item, index) => {
    const cur = (item as { current?: Record<string, number> }).current;
    if (!cur) throw new Error('grid');
    const rad = (cur.wind_direction_10m * Math.PI) / 180; // direction the wind blows FROM
    rows[Math.floor(index / GRID_COLS)].push({
      temp: cur.temperature_2m, wind: cur.wind_speed_10m, gust: cur.wind_gusts_10m, pressure: cur.pressure_msl,
      u: -cur.wind_speed_10m * Math.sin(rad), v: -cur.wind_speed_10m * Math.cos(rad),
    });
  });
  const grid = { lats, lons, rows };
  gridCache.set(key, { at: Date.now(), grid });
  return grid;
}

function stormPopup(storm: Omit<Storm, 'layer'>) {
  const box = document.createElement('div');
  box.className = 'weather-popup';
  const title = document.createElement('strong');
  title.textContent = `Bão ${storm.name}`;
  box.append(title);
  [
    storm.maxWindKmh != null ? `Gió mạnh nhất: ${Math.round(storm.maxWindKmh)} km/h` : '',
    ALERT_LABEL[storm.alert],
    storm.country ? `Khu vực: ${storm.country}` : '',
  ].filter(Boolean).forEach((text) => {
    const line = document.createElement('div');
    line.textContent = text;
    box.append(line);
  });
  return box;
}

type GdacsFeature = { geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> };

async function loadStorms(map: L.Map, signal: AbortSignal): Promise<Storm[]> {
  const list = await fetch('https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP?eventlist=TC', { signal });
  if (!list.ok) throw new Error('storm');
  const events = ((await list.json()) as { features?: GdacsFeature[] }).features ?? [];
  const current = events.filter((f) => f.properties.eventtype === 'TC' && String(f.properties.iscurrent) === 'true');
  ensurePane(map, 'weather-storm', 450, true);
  const storms: Storm[] = [];

  for (const event of current.slice(0, 8)) {
    const p = event.properties;
    const alert = (['Green', 'Orange', 'Red'].includes(String(p.alertlevel)) ? p.alertlevel : 'Green') as Storm['alert'];
    const color = ALERT_COLOR[alert];
    const severity = p.severitydata as { severity?: number } | undefined;
    const point = event.geometry.type === 'Point' ? (event.geometry.coordinates as [number, number]) : null;
    const meta = {
      id: `${p.eventid}-${p.episodeid}`,
      name: String(p.eventname || p.name || 'không tên'),
      alert,
      maxWindKmh: typeof severity?.severity === 'number' ? severity.severity : null,
      country: String(p.country ?? ''),
      center: point ? ([point[1], point[0]] as L.LatLngTuple) : null,
    };
    const group = L.layerGroup();

    try {
      const geometryUrl = (p.url as { geometry?: string } | undefined)?.geometry;
      if (geometryUrl) {
        const response = await fetch(geometryUrl, { signal });
        if (response.ok) {
          const shapes = ((await response.json()) as { features?: GdacsFeature[] }).features ?? [];
          for (const shape of shapes) {
            const cls = String(shape.properties.Class ?? '');
            const label = String(shape.properties.polygonlabel ?? '');
            // Wind-radius polygons: keep only the current position (km/h labels), not every forecast step.
            if (cls.startsWith('Poly_') && !/km\/h/.test(label)) continue;
            group.addLayer(L.geoJSON(shape as never, {
              pane: 'weather-storm',
              style: cls.startsWith('Poly_')
                ? { color: ALERT_COLOR[cls.replace('Poly_', '') as keyof typeof ALERT_COLOR] ?? color, weight: 1, fillOpacity: 0.12, interactive: false }
                : { color, weight: 3, dashArray: cls.includes('Forecast') ? '6 6' : undefined },
              pointToLayer: (_f, latlng) => L.circleMarker(latlng, { pane: 'weather-storm', radius: 4, color: '#fff', weight: 1, fillColor: color, fillOpacity: 1 }),
            }));
          }
        }
      }
    } catch (error) {
      if (signal.aborted) throw error;
    }

    if (meta.center) {
      group.addLayer(L.marker(meta.center, {
        pane: 'weather-storm',
        icon: L.divIcon({
          className: 'weather-storm-icon',
          iconSize: [34, 34],
          iconAnchor: [17, 17],
          html: `<span class="weather-storm" style="background:${color}">🌀</span>`,
        }),
      }).bindPopup(stormPopup(meta)));
    }
    group.addTo(map);
    storms.push({ ...meta, layer: group });
  }
  return storms;
}

function labelIcon(temp: number) {
  return L.divIcon({
    className: 'weather-label-icon',
    iconSize: [40, 20],
    iconAnchor: [20, 10],
    html: `<span class="weather-label">${Math.round(temp)}°</span>`,
  });
}

export function WeatherLayers({ map, rainOnStart = true }: { map: L.Map | null; rainOnStart?: boolean }) {
  const [active, setActive] = useState<Record<LayerKey, boolean>>({ rain: rainOnStart, cloud: false, wind: false, temp: false, storm: false });
  const [status, setStatus] = useState<Record<LayerKey, Status>>({ rain: 'idle', cloud: 'idle', wind: 'idle', temp: 'idle', storm: 'idle' });
  const [storms, setStorms] = useState<Storm[]>([]);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [gridTick, setGridTick] = useState(0);
  const [zoomTooFar, setZoomTooFar] = useState(false);
  const mode: FieldMode | null = active.wind ? 'wind' : active.temp ? 'temp' : null;

  const setLayerStatus = (key: LayerKey, value: Status) => setStatus((prev) => ({ ...prev, [key]: value }));

  // Rain radar (RainViewer).
  useEffect(() => {
    if (!map || !active.rain) return;
    const controller = new AbortController();
    let layer: L.TileLayer | null = null;
    setLayerStatus('rain', 'loading');
    (async () => {
      try {
        const response = await fetch('https://api.rainviewer.com/public/weather-maps.json', { signal: controller.signal });
        if (!response.ok) throw new Error('radar');
        const body = (await response.json()) as { host?: string; radar?: { past?: { path: string }[] } };
        const frame = body.radar?.past?.at(-1);
        if (!body.host || !frame || controller.signal.aborted) throw new Error('radar');
        ensurePane(map, 'weather-rain', 350);
        layer = L.tileLayer(`${body.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`, {
          pane: 'weather-rain', opacity: 0.65, maxNativeZoom: 7, maxZoom: 19, attribution: 'Radar mưa: RainViewer.com',
        }).addTo(map);
        setLayerStatus('rain', 'ready');
      } catch {
        if (!controller.signal.aborted) setLayerStatus('rain', 'error');
      }
    })();
    return () => { controller.abort(); layer?.remove(); };
  }, [map, active.rain]);

  // Cloud satellite (NASA GIBS, Himawari-9 band 13 infrared; latest frame).
  useEffect(() => {
    if (!map || !active.cloud) return;
    setLayerStatus('cloud', 'loading');
    let failures = 0;
    ensurePane(map, 'weather-cloud', 340);
    const layer = L.tileLayer(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Himawari_AHI_Band13_Clean_Infrared/default/default/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png',
      { pane: 'weather-cloud', opacity: 0.6, maxNativeZoom: 6, maxZoom: 19, attribution: 'Mây vệ tinh: NASA GIBS / JMA Himawari-9' },
    ).addTo(map);
    layer.on('load', () => setLayerStatus('cloud', 'ready'));
    layer.on('tileerror', () => { failures += 1; if (failures > 6) setLayerStatus('cloud', 'error'); });
    return () => { layer.remove(); };
  }, [map, active.cloud]);

  // Re-query the wind/temperature grid after the viewport settles.
  useEffect(() => {
    if (!map || !mode) return;
    let timer = 0;
    const onMove = () => { window.clearTimeout(timer); timer = window.setTimeout(() => setGridTick((n) => n + 1), 700); };
    map.on('moveend', onMove);
    setGridTick((n) => n + 1);
    return () => { window.clearTimeout(timer); map.off('moveend', onMove); };
  }, [map, mode]);

  const gridActive = mode !== null;
  useEffect(() => {
    if (!map || !gridActive || gridTick === 0) return;
    if (map.getZoom() < MIN_GRID_ZOOM) { setZoomTooFar(true); return; }
    setZoomTooFar(false);
    const controller = new AbortController();
    const key = active.wind ? 'wind' : 'temp';
    setLayerStatus(key, 'loading');
    fetchGrid(map, controller.signal)
      .then((next) => { setGrid(next); setLayerStatus(key, 'ready'); })
      .catch(() => { if (!controller.signal.aborted) setLayerStatus(key, 'error'); });
    return () => controller.abort();
    // `active.wind` only selects which chip shows the loading state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, gridActive, gridTick]);

  // Colour field + wind particles.
  useEffect(() => {
    if (!map || !mode) return;
    const field = new WeatherField(map, ensurePane(map, 'weather-field', 345));
    field.setData(zoomTooFar ? null : grid, mode);
    return () => field.destroy();
  }, [map, mode, grid, zoomTooFar]);

  // Sparse temperature labels, like Windy's city temperatures.
  useEffect(() => {
    if (!map || !active.temp || !grid || active.wind || zoomTooFar) return;
    ensurePane(map, 'weather-marks', 380);
    const group = L.layerGroup();
    grid.rows.forEach((row, r) => row.forEach((p, c) => {
      if (r % 2 === 0 && c % 2 === 0) group.addLayer(L.marker([grid.lats[r], grid.lons[c]], { pane: 'weather-marks', icon: labelIcon(p.temp), interactive: false, keyboard: false }));
    }));
    group.addTo(map);
    return () => { group.remove(); };
  }, [map, grid, active.temp, active.wind, zoomTooFar]);

  // Tropical cyclones (GDACS).
  useEffect(() => {
    if (!map || !active.storm) { setStorms([]); return; }
    const controller = new AbortController();
    let loaded: Storm[] = [];
    setLayerStatus('storm', 'loading');
    loadStorms(map, controller.signal)
      .then((rows) => { loaded = rows; setStorms(rows); setLayerStatus('storm', 'ready'); })
      .catch(() => { if (!controller.signal.aborted) setLayerStatus('storm', 'error'); });
    return () => { controller.abort(); loaded.forEach((s) => s.layer.remove()); setStorms([]); };
  }, [map, active.storm]);

  const toggle = (key: LayerKey) => setActive((prev) => {
    const next = { ...prev, [key]: !prev[key] };
    // Wind and temperature are both full-map colour fields, so only one at a time.
    if (next[key] && key === 'wind') next.temp = false;
    if (next[key] && key === 'temp') next.wind = false;
    return next;
  });

  return (
    <>
      <div className="weather-bar" role="group" aria-label="Chọn lớp thời tiết">
        {LAYERS.map((layer) => (
          <button
            key={layer.key}
            type="button"
            className={`weather-chip${active[layer.key] ? ' active' : ''}`}
            aria-pressed={active[layer.key]}
            title={active[layer.key] && status[layer.key] === 'error' ? 'Không tải được dữ liệu' : undefined}
            onClick={() => toggle(layer.key)}
          >
            <span aria-hidden="true">{layer.icon}</span>
            {layer.label}
            {active[layer.key] && status[layer.key] === 'loading' && <i className="weather-chip__spin" aria-label="Đang tải" />}
            {active[layer.key] && status[layer.key] === 'error' && <b className="weather-chip__err" aria-label="Không tải được">!</b>}
          </button>
        ))}
      </div>
      {mode && zoomTooFar && <small className="weather-note" role="status">Phóng to bản đồ để xem {mode === 'wind' ? 'gió' : 'nhiệt độ'}.</small>}
      <div className="weather-legends">
        {active.rain && status.rain === 'ready' && (
          <div className="weather-legend" aria-label="Chú giải cường độ mưa">
            <i style={{ background: 'linear-gradient(90deg, #9bd3ff, #2f8cf0, #1646c8, #7a2fd0)' }} />
            <span>Mưa nhẹ</span><span>Lớn (nguy cơ ngập)</span>
          </div>
        )}
        {mode === 'wind' && !zoomTooFar && (
          <div className="weather-legend" aria-label="Chú giải tốc độ gió">
            <i style={{ background: rampCss(WIND_STOPS) }} />
            <span>0 km/h</span><span>Gió mạnh 60+ km/h</span>
          </div>
        )}
        {mode === 'temp' && !zoomTooFar && (
          <div className="weather-legend" aria-label="Chú giải nhiệt độ">
            <i style={{ background: rampCss(TEMP_STOPS) }} />
            <span>-10 °C</span><span>42 °C</span>
          </div>
        )}
      </div>
      {active.storm && status.storm === 'ready' && (
        <div className="weather-storms" role="status">
          {storms.length === 0 ? <small>Hiện không có bão hoặc áp thấp nhiệt đới đang hoạt động.</small> : storms.map((s) => (
            <button
              key={s.id}
              type="button"
              className="weather-storms__item"
              style={{ borderLeftColor: ALERT_COLOR[s.alert] }}
              onClick={() => { if (s.center && map) map.flyTo(s.center, Math.max(map.getZoom(), 5)); }}
            >
              <strong>Bão {s.name}</strong>
              <span>{s.maxWindKmh != null ? `${Math.round(s.maxWindKmh)} km/h · ` : ''}{ALERT_LABEL[s.alert]}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
