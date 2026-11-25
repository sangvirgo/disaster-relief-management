import { Injectable, Logger } from '@nestjs/common';
import { AppError } from '@c48/technical/errors/errors';

export type WeatherLevel = 'WATCH' | 'WARNING' | 'SEVERE';
export type WeatherAlertCode = 'HEAVY_RAIN' | 'STRONG_WIND' | 'THUNDERSTORM';

export interface WeatherAlert {
  code: WeatherAlertCode;
  level: WeatherLevel;
  message: string;
  value: number | null;
}

export interface WeatherLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

/** Hour-by-hour series for charts; index i is the same hour in every array (local time, Asia/Bangkok). */
export interface WeatherHourly {
  time: string[];
  rain_mm: number[];
  gust_kmh: number[];
}

export interface ForecastSummary {
  rain_24h_mm: number;
  peak_rain_1h_mm: number;
  max_gust_kmh: number;
  alerts: WeatherAlert[];
  hourly: WeatherHourly;
}

export interface WeatherLocationForecast extends WeatherLocation, ForecastSummary {}

/** Forecast for one arbitrary point (a citizen's chosen location). */
export interface WeatherPointForecast extends ForecastSummary {
  temperature_c: number | null;
  latitude: number;
  longitude: number;
  source: string;
  attribution: string;
  disclaimer: string;
  horizon_hours: number;
  fetched_at: string;
  stale: boolean;
}

/** A current GDACS cyclone centre close to the SOS, not a landfall forecast or official local warning. */
export interface NearbyStorm {
  name: string;
  distance_km: number;
  alert_level: string;
  source: 'GDACS';
  fetched_at: string;
}

export interface WeatherSnapshot {
  source: string;
  attribution: string;
  disclaimer: string;
  horizon_hours: number;
  fetched_at: string;
  stale: boolean;
  alert_count: number;
  locations: WeatherLocationForecast[];
}

/** Key towns in the demo coverage area (public coordinates of provincial centres only). */
export const WEATHER_LOCATIONS: readonly WeatherLocation[] = [
  { id: 'hcm', name: 'TP. Hồ Chí Minh', latitude: 10.7769, longitude: 106.7009 },
  { id: 'can-tho', name: 'Cần Thơ', latitude: 10.0452, longitude: 105.7469 },
  { id: 'ca-mau', name: 'Cà Mau', latitude: 9.176, longitude: 105.15 },
  { id: 'vung-tau', name: 'Vũng Tàu', latitude: 10.4114, longitude: 107.1362 },
  { id: 'da-nang', name: 'Đà Nẵng', latitude: 16.0544, longitude: 108.2022 },
  { id: 'hue', name: 'Huế', latitude: 16.4637, longitude: 107.5909 },
  { id: 'vinh', name: 'Vinh, Nghệ An', latitude: 18.678, longitude: 105.681 },
  { id: 'quang-ngai', name: 'Quảng Ngãi', latitude: 15.1214, longitude: 108.8044 },
  { id: 'nha-trang', name: 'Nha Trang, Khánh Hòa', latitude: 12.238, longitude: 109.196 },
  { id: 'ha-noi', name: 'Hà Nội', latitude: 21.0285, longitude: 105.8542 },
  { id: 'hai-phong', name: 'Hải Phòng', latitude: 20.8449, longitude: 106.6881 },
  { id: 'ha-long', name: 'Hạ Long, Quảng Ninh', latitude: 20.9507, longitude: 107.0734 },
  { id: 'sa-pa', name: 'Sa Pa, Lào Cai', latitude: 22.337, longitude: 103.844 },
  { id: 'ha-giang', name: 'Hà Giang', latitude: 22.824, longitude: 104.984 },
  { id: 'dien-bien', name: 'Điện Biên', latitude: 21.386, longitude: 103.02 },
];

const HORIZON_HOURS = 24;
const CACHE_MS = 30 * 60_000;
const FETCH_TIMEOUT_MS = 8_000;
const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const GDACS_ENDPOINT = 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/EVENTS4APP?eventlist=TC';
const STORM_RADIUS_KM = 600;
const STORM_CACHE_MS = 15 * 60_000;

interface StormCentre { name: string; latitude: number; longitude: number; alert_level: string }

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radians = (degrees: number): number => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseCurrentStorms(body: unknown): StormCentre[] {
  const features = (body as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) throw new Error('GDACS features malformed');
  return features.flatMap((feature: unknown) => {
    const item = feature as { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } };
    const properties = item?.properties;
    const coordinates = item?.geometry?.coordinates;
    if (properties?.eventtype !== 'TC' || String(properties.iscurrent).toLowerCase() !== 'true' ||
        item.geometry?.type !== 'Point' || !Array.isArray(coordinates) || coordinates.length < 2 ||
        !finite(coordinates[0]) || !finite(coordinates[1]) || Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90) return [];
    const name = String(properties.name || properties.eventname || `TC ${properties.eventid ?? ''}`).trim().slice(0, 80);
    return [{ name, longitude: coordinates[0], latitude: coordinates[1], alert_level: String(properties.alertlevel ?? 'Unknown').slice(0, 20) }];
  });
}

const CACHE_MAX_AGE_MS = CACHE_MS;
const PROVIDER_NOTICE = {
  source: 'Open-Meteo',
  attribution: 'Dữ liệu dự báo: Open-Meteo.com (CC BY 4.0).',
  disclaimer: 'Đây là dự báo mô hình tham khảo, không thay thế cảnh báo chính thức của Trung tâm Dự báo khí tượng thủy văn quốc gia và chính quyền địa phương.',
} as const;

const LEVEL_ORDER: Record<WeatherLevel, number> = { WATCH: 1, WARNING: 2, SEVERE: 3 };

interface HourlyBlock {
  time: string[];
  precipitation: (number | null)[];
  wind_gusts_10m: (number | null)[];
  weather_code: (number | null)[];
  temperature_2m?: (number | null)[];
}

const isHourly = (value: HourlyBlock | undefined): value is HourlyBlock =>
  Boolean(value) && Array.isArray(value!.time) && Array.isArray(value!.precipitation)
  && Array.isArray(value!.wind_gusts_10m) && Array.isArray(value!.weather_code);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Derives Vietnamese alerts from forecast aggregates. Thresholds follow the rainfall classes used in
 * Vietnamese public forecasts (50/100/200 mm per 24 h) and Beaufort 6/8/10 gusts; they are advisory only.
 */
export function deriveAlerts(rain24h: number, peakRain1h: number, maxGust: number, thunderstorm: boolean): WeatherAlert[] {
  const alerts: WeatherAlert[] = [];
  const rainLevel: WeatherLevel | null = rain24h >= 200 ? 'SEVERE' : rain24h >= 100 ? 'WARNING' : (rain24h >= 50 || peakRain1h >= 30) ? 'WATCH' : null;
  if (rainLevel) {
    const label = rainLevel === 'SEVERE' ? 'Mưa đặc biệt lớn' : rainLevel === 'WARNING' ? 'Mưa rất lớn' : 'Mưa lớn';
    alerts.push({
      code: 'HEAVY_RAIN', level: rainLevel, value: round1(rain24h),
      message: `${label}: dự báo khoảng ${Math.round(rain24h)} mm trong 24 giờ tới. Nguy cơ ngập úng và sạt lở đất ở vùng trũng, ven sông, chân dốc.`,
    });
  }
  const windLevel: WeatherLevel | null = maxGust >= 89 ? 'SEVERE' : maxGust >= 62 ? 'WARNING' : maxGust >= 50 ? 'WATCH' : null;
  if (windLevel) {
    const label = windLevel === 'SEVERE' ? 'Gió giật rất mạnh' : windLevel === 'WARNING' ? 'Gió giật mạnh' : 'Gió giật khá mạnh';
    alerts.push({
      code: 'STRONG_WIND', level: windLevel, value: round1(maxGust),
      message: `${label}: gió giật tới khoảng ${Math.round(maxGust)} km/h. Hạn chế ra đường, chằng chống mái nhà, tránh gần cây cao và biển quảng cáo.`,
    });
  }
  if (thunderstorm) {
    alerts.push({
      code: 'THUNDERSTORM', level: 'WATCH', value: null,
      message: 'Có dông, sét, có thể kèm mưa đá và gió giật. Tránh trú dưới gốc cây hoặc ở nơi trống trải.',
    });
  }
  return alerts.sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level]);
}

export function summarizeHourly(hourly: HourlyBlock): ForecastSummary {
  const rain = hourly.precipitation.slice(0, HORIZON_HOURS).filter(finite);
  const gusts = hourly.wind_gusts_10m.slice(0, HORIZON_HOURS).filter(finite);
  const codes = hourly.weather_code.slice(0, HORIZON_HOURS).filter(finite);
  const rain24h = rain.reduce((sum, value) => sum + value, 0);
  const peakRain = rain.length ? Math.max(...rain) : 0;
  const maxGust = gusts.length ? Math.max(...gusts) : 0;
  const hours = Math.min(HORIZON_HOURS, hourly.time.length);
  return {
    rain_24h_mm: round1(rain24h),
    peak_rain_1h_mm: round1(peakRain),
    max_gust_kmh: round1(maxGust),
    alerts: deriveAlerts(rain24h, peakRain, maxGust, codes.some((code) => code >= 95)),
    hourly: {
      time: hourly.time.slice(0, hours),
      rain_mm: Array.from({ length: hours }, (_, i) => round1(finite(hourly.precipitation[i]) ? hourly.precipitation[i]! : 0)),
      gust_kmh: Array.from({ length: hours }, (_, i) => round1(finite(hourly.wind_gusts_10m[i]) ? hourly.wind_gusts_10m[i]! : 0)),
    },
  };
}

export function summarizeForecast(location: WeatherLocation, hourly: HourlyBlock): WeatherLocationForecast {
  return { ...location, ...summarizeHourly(hourly) };
}

/** Rounding to 0.1° (about 11 km) lets nearby citizens share one provider call and one cache entry. */
const POINT_GRID = 10;
const POINT_CACHE_MAX = 500;
const snap = (value: number): number => Math.round(value * POINT_GRID) / POINT_GRID;
const gridKey = (latitude: number, longitude: number): string => `${snap(latitude)},${snap(longitude)}`;

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private cache: { at: number; snapshot: WeatherSnapshot } | null = null;
  private inflight: Promise<WeatherSnapshot> | null = null;
  private readonly pointCache = new Map<string, { at: number; forecast: WeatherPointForecast }>();
  private readonly pointInflight = new Map<string, Promise<WeatherPointForecast>>();
  private stormCache: { at: number; fetched_at: string; centres: StormCentre[] } | null = null;
  private stormInflight: Promise<{ at: number; fetched_at: string; centres: StormCentre[] }> | null = null;

  async nearbyStorm(latitude: number, longitude: number): Promise<NearbyStorm | null> {
    try {
      if (!this.stormCache || Date.now() - this.stormCache.at >= STORM_CACHE_MS) {
        this.stormInflight ??= this.fetchCurrentStorms().finally(() => { this.stormInflight = null; });
        this.stormCache = await this.stormInflight;
      }
      const closest = this.stormCache.centres.map((centre) => ({
        centre, distance: distanceKm(latitude, longitude, centre.latitude, centre.longitude),
      })).sort((a, b) => a.distance - b.distance)[0];
      if (!closest || closest.distance > STORM_RADIUS_KM) return null;
      return {
        name: closest.centre.name, distance_km: Math.round(closest.distance),
        alert_level: closest.centre.alert_level, source: 'GDACS', fetched_at: this.stormCache.fetched_at,
      };
    } catch (error) {
      this.logger.warn(`GDACS_PROVIDER_FAILED ${error instanceof Error ? error.name : 'unknown'}`);
      return null;
    }
  }

  private async fetchCurrentStorms(): Promise<{ at: number; fetched_at: string; centres: StormCentre[] }> {
    const response = await fetch(GDACS_ENDPOINT, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`GDACS status ${response.status}`);
    const centres = parseCurrentStorms(await response.json() as unknown);
    return { at: Date.now(), fetched_at: new Date().toISOString(), centres };
  }
  /** Public alerts. Serves the cached forecast for 30 minutes. */
  async alerts(onlyActive = false): Promise<WeatherSnapshot> {
    const snapshot = await this.snapshot();
    const locations = snapshot.locations
      .filter((location) => !onlyActive || location.alerts.length > 0);
    return { ...snapshot, locations, alert_count: locations.reduce((sum, location) => sum + location.alerts.length, 0) };
  }

  /**
   * Forecast for the citizen's own location, cached per 0.1° cell for 30 minutes. Only the snapped cell
   * centre is sent to the provider, never the caller's exact coordinates.
   */
  async forecastAt(latitude: number, longitude: number): Promise<WeatherPointForecast> {
    const key = gridKey(latitude, longitude);
    const cached = this.pointCache.get(key);
    if (cached && Date.now() - cached.at < CACHE_MAX_AGE_MS) return { ...cached.forecast, latitude, longitude };
    let pending = this.pointInflight.get(key);
    if (!pending) {
      pending = this.fetchPoint(snap(latitude), snap(longitude)).finally(() => { this.pointInflight.delete(key); });
      this.pointInflight.set(key, pending);
    }
    try {
      const forecast = await pending;
      this.pointCache.delete(key);
      this.pointCache.set(key, { at: Date.now(), forecast });
      if (this.pointCache.size > POINT_CACHE_MAX) this.pointCache.delete(this.pointCache.keys().next().value as string);
      return { ...forecast, latitude, longitude };
    } catch (error) {
      this.logger.warn(`WEATHER_POINT_FAILED ${error instanceof Error ? error.name : 'unknown'}`);
      if (cached) return { ...cached.forecast, latitude, longitude, stale: true };
      throw new AppError('RESPONSE_UNAVAILABLE', { status: 503 });
    }
  }

  private async fetchPoint(latitude: number, longitude: number): Promise<WeatherPointForecast> {
    const [result] = await this.requestForecast([latitude], [longitude]);
    const hourly = (result as { hourly?: HourlyBlock } | undefined)?.hourly;
    if (!isHourly(hourly)) throw new Error('provider hourly block malformed');
    return {
      latitude, longitude, ...summarizeHourly(hourly),
      temperature_c: finite(hourly.temperature_2m?.[0]) ? round1(hourly.temperature_2m[0]!) : null,
      ...PROVIDER_NOTICE, horizon_hours: HORIZON_HOURS, fetched_at: new Date().toISOString(), stale: false,
    };
  }

  private async snapshot(): Promise<WeatherSnapshot> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.snapshot;
    this.inflight ??= this.fetchSnapshot().finally(() => { this.inflight = null; });
    try {
      const snapshot = await this.inflight;
      this.cache = { at: Date.now(), snapshot };
      return snapshot;
    } catch (error) {
      this.logger.warn(`WEATHER_PROVIDER_FAILED ${error instanceof Error ? error.name : 'unknown'}`);
      if (this.cache) return { ...this.cache.snapshot, stale: true };
      throw new AppError('RESPONSE_UNAVAILABLE', { status: 503 });
    }
  }

  private async requestForecast(latitudes: number[], longitudes: number[]): Promise<unknown[]> {
    const url = new URL(ENDPOINT);
    url.searchParams.set('latitude', latitudes.join(','));
    url.searchParams.set('longitude', longitudes.join(','));
    url.searchParams.set('hourly', 'precipitation,wind_gusts_10m,weather_code,temperature_2m');
    url.searchParams.set('forecast_hours', String(HORIZON_HOURS));
    url.searchParams.set('timezone', 'Asia/Bangkok');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`provider status ${response.status}`);
      const body = await response.json() as unknown;
      const results = Array.isArray(body) ? body : [body];
      if (results.length !== latitudes.length) throw new Error('provider result count mismatch');
      return results;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchSnapshot(): Promise<WeatherSnapshot> {
    const results = await this.requestForecast(
      WEATHER_LOCATIONS.map((location) => location.latitude),
      WEATHER_LOCATIONS.map((location) => location.longitude),
    );
    const locations = WEATHER_LOCATIONS.map((location, index) => {
      const hourly = (results[index] as { hourly?: HourlyBlock } | undefined)?.hourly;
      if (!isHourly(hourly)) throw new Error('provider hourly block malformed');
      return summarizeForecast(location, hourly);
    });
    return {
      source: PROVIDER_NOTICE.source,
      attribution: PROVIDER_NOTICE.attribution,
      disclaimer: PROVIDER_NOTICE.disclaimer,
      horizon_hours: HORIZON_HOURS,
      fetched_at: new Date().toISOString(),
      stale: false,
      alert_count: locations.reduce((sum, location) => sum + location.alerts.length, 0),
      locations,
    };
  }
}
