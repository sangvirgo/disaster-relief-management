import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MobileApiError } from '../../../api/client';
import { ResponseApi } from '../../../api/responseApi';
import { THEME } from '../../../constants/theme';
import { WeatherAlertLevel, WeatherPointForecast } from '../../../types/api';

const REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const DEBOUNCE_MS = 600;
const WEATHER_LEVELS: Record<WeatherAlertLevel, { label: string; color: string; background: string }> = {
  WATCH: { label: 'Lưu ý', color: THEME.colors.primary.dark, background: THEME.colors.primary.bg },
  WARNING: { label: 'Cảnh báo', color: THEME.colors.warning.dark, background: THEME.colors.warning.bg },
  SEVERE: { label: 'Nguy hiểm', color: THEME.colors.emergency.dark, background: THEME.colors.emergency.bg },
};
const LEVEL_RANK: Record<WeatherAlertLevel, number> = { WATCH: 1, WARNING: 2, SEVERE: 3 };

type WeatherError = 'outside' | 'unavailable';
type WeatherViewState = {
  queryKey: string;
  data: WeatherPointForecast | null;
  loading: boolean;
  error?: WeatherError;
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value);
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Chưa rõ thời điểm';
  return date.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });
}

export function SosWeatherCard({ point }: { point: { latitude: number; longitude: number } | null }) {
  const latitude = point?.latitude;
  const longitude = point?.longitude;
  const hasFinitePoint = latitude !== undefined && longitude !== undefined &&
    Number.isFinite(latitude) && Number.isFinite(longitude);
  const pointInForecastArea = hasFinitePoint && latitude >= 7.5 && latitude <= 24.5 &&
    longitude >= 101.5 && longitude <= 112;
  const queryLatitude = pointInForecastArea && latitude !== undefined
    ? Math.round(latitude * 10) / 10
    : undefined;
  const queryLongitude = pointInForecastArea && longitude !== undefined
    ? Math.round(longitude * 10) / 10
    : undefined;
  const validPoint = hasFinitePoint;
  const queryKey = validPoint ? `${queryLatitude},${queryLongitude}` : '';
  const [viewState, setViewState] = useState<WeatherViewState>({
    queryKey: '',
    data: null,
    loading: false,
  });
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    if (queryLatitude === undefined || queryLongitude === undefined) return undefined;

    let active = true;
    const refresh = async () => {
      setViewState((current) => ({
        queryKey,
        data: current.queryKey === queryKey ? current.data : null,
        loading: true,
      }));
      try {
        const data = await ResponseApi.getWeatherAt(queryLatitude, queryLongitude);
        if (active) setViewState({ queryKey, data, loading: false });
      } catch (error) {
        if (!active) return;
        setViewState((current) => ({
          queryKey,
          data: current.queryKey === queryKey ? current.data : null,
          loading: false,
          error: error instanceof MobileApiError && error.status === 400 ? 'outside' : 'unavailable',
        }));
      }
    };

    const debounceTimer = setTimeout(() => { void refresh(); }, DEBOUNCE_MS);
    const refreshTimer = setInterval(() => { void refresh(); }, REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      clearTimeout(debounceTimer);
      clearInterval(refreshTimer);
    };
  }, [queryKey, queryLatitude, queryLongitude, retryVersion]);

  if (!validPoint) {
    return (
      <View style={[styles.card, styles.clearCard]} accessibilityLabel="Thông tin dự báo thời tiết">
        <Text style={styles.title}>Dự báo tại vị trí cần hỗ trợ</Text>
        <Text style={styles.body}>Chọn vị trí trên bản đồ để xem dự báo mưa và gió trong 24 giờ tới.</Text>
      </View>
    );
  }

  if (!pointInForecastArea) {
    return (
      <View style={[styles.card, styles.clearCard]} accessibilityLabel="Thông tin dự báo thời tiết">
        <Text style={styles.title}>Dự báo tại vị trí cần hỗ trợ</Text>
        <Text style={styles.body}>Vị trí này nằm ngoài vùng có dự báo. Bạn vẫn có thể gửi yêu cầu SOS.</Text>
      </View>
    );
  }

  const current = viewState.queryKey === queryKey ? viewState : null;
  const data = current?.data ?? null;
  const loading = !current || current.loading;
  const error = current?.error;
  const alerts = data?.alerts ?? [];
  const topAlert = alerts.slice().sort((left, right) => LEVEL_RANK[right.level] - LEVEL_RANK[left.level])[0];
  const severityStyle = topAlert ? WEATHER_LEVELS[topAlert.level] : null;
  const cardStyle = topAlert?.level === 'SEVERE'
    ? styles.severeCard
    : topAlert?.level === 'WARNING'
      ? styles.warningCard
      : topAlert
        ? styles.watchCard
        : styles.clearCard;

  return (
    <View style={[styles.card, cardStyle]} accessibilityLabel="Dự báo thời tiết tại vị trí SOS">
      <View style={styles.header}>
        <Text style={styles.title}>Thời tiết tại vị trí đã chọn</Text>
        {loading ? <ActivityIndicator size="small" color={severityStyle?.color ?? THEME.colors.primary.main} /> : null}
      </View>
      <Text style={styles.subtitle}>Dự báo trong 24 giờ tới · vị trí làm tròn khoảng 11 km</Text>

      {error === 'outside' && !data ? (
        <Text style={styles.body}>Vị trí này nằm ngoài vùng có dự báo. Bạn vẫn có thể gửi yêu cầu SOS.</Text>
      ) : error === 'unavailable' && !data ? (
        <Text style={styles.body}>Chưa cập nhật được thời tiết. Bạn vẫn có thể gửi yêu cầu SOS.</Text>
      ) : loading && !data ? (
        <Text style={styles.body}>Đang kiểm tra dự báo thời tiết…</Text>
      ) : null}

      {data ? (
        <>
          {alerts.length > 0 ? alerts.map((alert) => {
            const level = WEATHER_LEVELS[alert.level];
            return (
              <View key={alert.code} style={[styles.alert, { backgroundColor: level.background }]}>
                <Text style={[styles.alertLabel, { color: level.color }]}>{level.label} · {alert.message}</Text>
              </View>
            );
          }) : <Text style={styles.body}>Hiện chưa có cảnh báo mưa lớn hoặc gió mạnh tại đây.</Text>}

          <View style={styles.metrics}>
            <Text style={styles.metric}>Mưa 24 giờ: {formatNumber(data.rain_24h_mm)} mm</Text>
            <Text style={styles.metric}>Mưa lớn nhất: {formatNumber(data.peak_rain_1h_mm)} mm/giờ</Text>
            <Text style={styles.metric}>Gió giật tối đa: {formatNumber(data.max_gust_kmh)} km/giờ</Text>
          </View>
          {data.stale ? <Text style={styles.note}>Dữ liệu dự báo có thể đã cũ.</Text> : null}
          {error === 'unavailable' ? <Text style={styles.note}>Chưa tải được bản cập nhật mới; đang hiển thị dữ liệu đã nhận trước đó.</Text> : null}
          <Text style={styles.note}>Cập nhật lúc {formatTime(data.fetched_at)} · {data.attribution}</Text>
          <Text style={styles.disclaimer}>{data.disclaimer}</Text>
        </>
      ) : null}

      {error ? (
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => setRetryVersion((version) => version + 1)}
          accessibilityRole="button"
          accessibilityLabel="Thử tải lại dự báo thời tiết"
        >
          <Text style={styles.retryText}>Thử tải lại</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    marginBottom: 12,
    padding: 14,
    borderWidth: 1,
    borderRadius: 12,
    borderLeftWidth: 5,
    gap: 8,
  },
  clearCard: {
    backgroundColor: THEME.colors.surface.card,
    borderColor: THEME.colors.surface.border,
    borderLeftColor: THEME.colors.primary.main,
  },
  watchCard: {
    backgroundColor: THEME.colors.primary.bg,
    borderColor: THEME.colors.primary.border,
    borderLeftColor: THEME.colors.primary.main,
  },
  warningCard: {
    backgroundColor: THEME.colors.warning.bg,
    borderColor: THEME.colors.warning.border,
    borderLeftColor: THEME.colors.warning.main,
  },
  severeCard: {
    backgroundColor: THEME.colors.emergency.bg,
    borderColor: THEME.colors.emergency.border,
    borderLeftColor: THEME.colors.emergency.main,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { flex: 1, color: THEME.colors.text.primary, fontSize: THEME.typography.fontSizes.base, fontWeight: '700' },
  subtitle: { color: THEME.colors.text.secondary, fontSize: THEME.typography.fontSizes.xs },
  body: { color: THEME.colors.text.primary, fontSize: THEME.typography.fontSizes.sm, lineHeight: 21 },
  alert: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
  alertLabel: { fontSize: THEME.typography.fontSizes.sm, fontWeight: '700', lineHeight: 20 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: THEME.colors.surface.card,
    color: THEME.colors.text.secondary,
    fontSize: THEME.typography.fontSizes.xs,
  },
  note: { color: THEME.colors.text.secondary, fontSize: THEME.typography.fontSizes.xs, lineHeight: 18 },
  disclaimer: { color: THEME.colors.text.muted, fontSize: THEME.typography.fontSizes.xs, lineHeight: 18 },
  retryButton: {
    alignSelf: 'flex-start',
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: THEME.colors.surface.card,
  },
  retryText: { color: THEME.colors.primary.dark, fontWeight: '700', fontSize: THEME.typography.fontSizes.sm },
});
