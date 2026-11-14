import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { label, timeLabel } from '../../i18n/labels';
import { Card } from '../../components/ui/Card';

type WeatherAlertsResponse = {
  attribution: string;
  disclaimer: string;
  stale: boolean;
  fetched_at: string;
  locations: {
    id: string;
    name: string;
    region_code: string;
    alerts: { code: string; level: string; message: string }[];
  }[];
};

const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

export function SosWeatherAlerts() {
  const [data, setData] = useState<WeatherAlertsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    let fetching = false;
    let lastRequestAt = 0;
    async function refresh() {
      if (!active || fetching || document.visibilityState === 'hidden') return;
      fetching = true;
      lastRequestAt = Date.now();
      try {
        const result = await api<WeatherAlertsResponse>('response', '/weather/alerts?active_only=true', { credentials: 'omit' });
        if (active) { setData(result); setError(false); }
      } catch {
        if (active) setError(true);
      } finally {
        fetching = false;
        if (active) setLoading(false);
      }
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRequestAt >= REFRESH_INTERVAL_MS) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const locations = data?.locations.filter((place) => place.alerts.length > 0) ?? [];
  const severity = locations.some((place) => place.alerts.some((alert) => alert.level === 'SEVERE'))
    ? 'severe' : locations.some((place) => place.alerts.some((alert) => alert.level === 'WARNING'))
      ? 'warning' : locations.length ? 'watch' : 'clear';
  return <Card className={`sos-weather-banner sos-weather-banner--${severity}`} aria-label="Thông tin thời tiết">
    <span className="sos-weather-symbol" aria-hidden="true">{locations.length ? '!' : 'i'}</span>
    <div className="sos-weather-body">
      {loading ? <p role="status">Đang kiểm tra cảnh báo thời tiết…</p>
        : error && !data ? <p role="status">Chưa cập nhật được thời tiết. Bạn vẫn có thể gửi yêu cầu SOS.</p>
          : locations.length ? <p role="alert"><strong>Cảnh báo thời tiết:</strong>{' '}
              {locations.slice(0, 3).map((place, index) => <span key={place.id}>
                {index > 0 ? '; ' : ''}<strong>{place.name} ({label(place.region_code)})</strong>
                {' — '}{[...new Set(place.alerts.map((alert) => label(alert.code)))].join(', ')}
              </span>)}
              {locations.length > 3 && `; và ${locations.length - 3} khu vực khác.`}
            </p>
            : <p>Hiện chưa có cảnh báo thời tiết nào tại các khu vực theo dõi.</p>}
      {error && data && <small>Chưa cập nhật được dữ liệu mới; đang hiển thị thông tin đã tải.</small>}
      {data?.stale && <small>Dữ liệu thời tiết có thể đã cũ.</small>}
      <details className="sos-weather-details">
        <summary>Nguồn dữ liệu và lưu ý</summary>
        {data ? <p>Dữ liệu lúc {timeLabel(data.fetched_at)}. {data.disclaimer} {data.attribution}</p>
          : <p>Dự báo mô hình chỉ để tham khảo, không thay thế cảnh báo chính thức. Nguồn: Open-Meteo.com (CC BY 4.0).</p>}
      </details>
    </div>
  </Card>;
}
