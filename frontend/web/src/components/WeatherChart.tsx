export type WeatherHourly = { time: string[]; rain_mm: number[]; gust_kmh: number[] };

const W = 300;
const H = 132;
const PAD = { left: 30, right: 34, top: 8, bottom: 22 };

const hourLabel = (iso: string): string => `${iso.slice(11, 13)}h`;

/**
 * Hourly rain (bars, mm/h) and wind gusts (line, km/h) as an inline SVG string.
 * Built only from numbers and fixed Vietnamese text, so it is safe to inject with innerHTML.
 */
export function weatherChartSvg(hourly: WeatherHourly): string {
  const n = Math.min(hourly.time.length, hourly.rain_mm.length, hourly.gust_kmh.length);
  if (!n) return '';
  const rain = hourly.rain_mm.slice(0, n).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const gust = hourly.gust_kmh.slice(0, n).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const rainMax = Math.max(5, Math.ceil(Math.max(...rain)));
  const gustMax = Math.max(40, Math.ceil(Math.max(...gust) / 10) * 10);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = innerW / n;
  const barW = Math.max(2, step - 2);
  const y = (value: number, max: number) => PAD.top + innerH - (value / max) * innerH;
  const bars = rain.map((value, i) => {
    const top = y(value, rainMax);
    return `<rect x="${(PAD.left + i * step + 1).toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${(PAD.top + innerH - top).toFixed(1)}" fill="#2563eb" opacity="0.85"/>`;
  }).join('');
  const line = gust.map((value, i) => `${(PAD.left + i * step + step / 2).toFixed(1)},${y(value, gustMax).toFixed(1)}`).join(' ');
  const ticks = hourly.time.slice(0, n).map((iso, i) => (i % 6 === 0
    ? `<text x="${(PAD.left + i * step + step / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9" fill="#64748b">${hourLabel(iso)}</text>` : '')).join('');
  const peakRain = Math.max(...rain);
  const peakGust = Math.max(...gust);
  const summary = `Biểu đồ 24 giờ tới: mưa lớn nhất ${peakRain.toFixed(1)} mm mỗi giờ, gió giật tối đa ${Math.round(peakGust)} km/h.`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${summary}" style="max-width:${W + 40}px;display:block">`
    + `<line x1="${PAD.left}" y1="${PAD.top + innerH}" x2="${W - PAD.right}" y2="${PAD.top + innerH}" stroke="#cbd5e1"/>`
    + `<line x1="${PAD.left}" y1="${PAD.top}" x2="${W - PAD.right}" y2="${PAD.top}" stroke="#e2e8f0" stroke-dasharray="3 3"/>`
    + bars
    + `<polyline points="${line}" fill="none" stroke="#e8710a" stroke-width="2" stroke-linejoin="round"/>`
    + `<text x="${PAD.left - 4}" y="${PAD.top + 8}" text-anchor="end" font-size="9" fill="#2563eb">${rainMax}</text>`
    + `<text x="${PAD.left - 4}" y="${PAD.top + innerH}" text-anchor="end" font-size="9" fill="#2563eb">0</text>`
    + `<text x="${W - PAD.right + 4}" y="${PAD.top + 8}" font-size="9" fill="#e8710a">${gustMax}</text>`
    + `<text x="${W - PAD.right + 4}" y="${PAD.top + innerH}" font-size="9" fill="#e8710a">0</text>`
    + ticks
    + `</svg>`
    + `<div style="display:flex;gap:12px;font-size:11px;color:#475569;margin-top:2px">`
    + `<span><b style="color:#2563eb">▮</b> Mưa (mm/giờ)</span><span><b style="color:#e8710a">━</b> Gió giật (km/h)</span></div>`;
}

export function WeatherChart({ hourly }: { hourly: WeatherHourly }) {
  const svg = weatherChartSvg(hourly);
  if (!svg) return null;
  return <div className="weather-chart" dangerouslySetInnerHTML={{ __html: svg }} />;
}
