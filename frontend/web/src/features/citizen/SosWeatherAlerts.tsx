import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { label, timeLabel } from '../../i18n/labels';
import { Card } from '../../components/ui/Card';
import { WeatherChart, type WeatherHourly } from '../../components/WeatherChart';

type PointWeather = {
  attribution: string;
  disclaimer: string;
  stale: boolean;
  fetched_at: string;
  rain_24h_mm: number;
  peak_rain_1h_mm: number;
  max_gust_kmh: number;
  alerts: { code: string; level: 'WATCH' | 'WARNING' | 'SEVERE'; message: string }[];
  hourly: WeatherHourly;
};

const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const DEBOUNCE_MS = 600;
const rank = { WATCH: 1, WARNING: 2, SEVERE: 3 } as const;

/** Weather for the place the person chose on the SOS form; it never guesses where they are. */
export function SosWeatherAlerts({ point }: { point: { latitude: number; longitude: number } | null }) {
  const [data, setData] = useState<PointWeather | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<'none' | 'unavailable' | 'outside'>('none');
  const latitude = point?.latitude;
  const longitude = point?.longitude;

  useEffect(() => {
    setData(null);
    setError('none');
    if (latitude === undefined || longitude === undefined || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setLoading(false);
      return;
    }
    let active = true;
    const query = `latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}`;
    async function refresh() {
      if (!active || document.visibilityState === 'hidden') return;
      setLoading(true);
      try {
        const result = await api<PointWeather>('response', `/weather/at?${query}`, { credentials: 'omit' });
        if (active) { setData(result); setError('none'); }
      } catch (cause) {
        if (active) setError(cause instanceof ApiError && cause.status === 400 ? 'outside' : 'unavailable');
      } finally {
        if (active) setLoading(false);
      }
    }
    const first = window.setTimeout(() => { void refresh(); }, DEBOUNCE_MS);
    const timer = window.setInterval(() => { void refresh(); }, REFRESH_INTERVAL_MS);
    return () => { active = false; window.clearTimeout(first); window.clearInterval(timer); };
  }, [latitude, longitude]);

  if (!point) {
    return <Card className="sos-weather-banner sos-weather-banner--clear" aria-label="Thông tin thời tiết">
      <span className="sos-weather-symbol" aria-hidden="true">i</span>
      <div className="sos-weather-body">
        <p>Chọn vị trí cần hỗ trợ trên bản đồ để xem dự báo mưa, gió tại đúng nơi đó.</p>
      </div>
    </Card>;
  }

  const top = data ? [...data.alerts].sort((a, b) => rank[b.level] - rank[a.level])[0] : undefined;
  const severity = !top ? 'clear' : top.level === 'SEVERE' ? 'severe' : top.level === 'WARNING' ? 'warning' : 'watch';
  return <Card className={`sos-weather-banner sos-weather-banner--${severity}`} aria-label="Thời tiết tại vị trí đã chọn">
    <span className="sos-weather-symbol" aria-hidden="true">{top ? '!' : 'i'}</span>
    <div className="sos-weather-body">
      <strong>Thời tiết tại vị trí đã chọn (24 giờ tới)</strong>
      {loading && !data && <p role="status">Đang kiểm tra thời tiết…</p>}
      {error === 'outside' && <p role="status">Vị trí này nằm ngoài vùng có dự báo. Bạn vẫn có thể gửi yêu cầu SOS.</p>}
      {error === 'unavailable' && !data && <p role="status">Chưa cập nhật được thời tiết. Bạn vẫn có thể gửi yêu cầu SOS.</p>}
      {data && <>
        {data.alerts.length
          ? data.alerts.map((alert) => <p key={alert.code} role={alert.level === 'WATCH' ? 'status' : 'alert'}>
              <strong>{label(alert.level)} · {label(alert.code)}:</strong> {alert.message}
            </p>)
          : <p>Hiện chưa có cảnh báo mưa lớn hoặc gió mạnh tại đây.</p>}
        <p className="muted">Mưa dự báo {data.rain_24h_mm} mm trong 24 giờ, cao nhất {data.peak_rain_1h_mm} mm/giờ · gió giật tối đa {data.max_gust_kmh} km/h.</p>
        <WeatherChart hourly={data.hourly} />
        {data.stale && <small>Dữ liệu thời tiết có thể đã cũ.</small>}
        {error === 'unavailable' && <small>Chưa cập nhật được dữ liệu mới; đang hiển thị thông tin đã tải.</small>}
        <details className="sos-weather-details">
          <summary>Nguồn dữ liệu và lưu ý</summary>
          <p>Dữ liệu lúc {timeLabel(data.fetched_at)}. Vị trí chỉ được làm tròn khoảng 10 km khi tra dự báo. {data.disclaimer} {data.attribution}</p>
        </details>
      </>}
    </div>
  </Card>;
}
