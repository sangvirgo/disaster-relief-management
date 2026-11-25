import { deriveAlerts, summarizeForecast, summarizeHourly, WeatherService, WEATHER_LOCATIONS } from '../src/weather/weather.service';
import { validationExceptionFactory } from '@c48/technical/http/validation-errors';
import type { ValidationError } from 'class-validator';
import { jest } from '@jest/globals';

describe('weather alert derivation', () => {
  it('raises nothing for calm weather', () => {
    expect(deriveAlerts(5, 2, 30, false)).toEqual([]);
  });

  it.each([
    [60, 'WATCH'], [120, 'WARNING'], [250, 'SEVERE'],
  ])('classifies %d mm per 24 h as %s heavy rain', (rain, level) => {
    expect(deriveAlerts(rain, 5, 10, false)[0]).toMatchObject({ code: 'HEAVY_RAIN', level });
  });

  it('flags a short cloudburst even when the daily total is modest', () => {
    expect(deriveAlerts(35, 32, 10, false)[0]).toMatchObject({ code: 'HEAVY_RAIN', level: 'WATCH' });
  });

  it.each([
    [55, 'WATCH'], [70, 'WARNING'], [95, 'SEVERE'],
  ])('classifies %d km/h gusts as %s', (gust, level) => {
    expect(deriveAlerts(0, 0, gust, false)[0]).toMatchObject({ code: 'STRONG_WIND', level });
  });

  it('orders the most severe alert first and writes Vietnamese copy', () => {
    const alerts = deriveAlerts(120, 10, 55, true);
    expect(alerts.map((alert) => alert.code)).toEqual(['HEAVY_RAIN', 'STRONG_WIND', 'THUNDERSTORM']);
    expect(alerts[0]!.message).toContain('Mưa rất lớn');
  });

  it('summarizes only the 24 h horizon and ignores null provider values', () => {
    const location = WEATHER_LOCATIONS[0]!;
    const precipitation = [...Array<number | null>(24).fill(3), 500];
    const forecast = summarizeForecast(location, {
      time: [], precipitation: [null, ...precipitation], wind_gusts_10m: [20, null, 40], weather_code: [1, 95],
    });
    expect(forecast.rain_24h_mm).toBe(69);
    expect(forecast.max_gust_kmh).toBe(40);
    expect(forecast.alerts.map((alert) => alert.code)).toEqual(['HEAVY_RAIN', 'THUNDERSTORM']);
  });
});

describe('hourly series for charts', () => {
  it('keeps aligned 24 h arrays, replaces missing values with 0 and rounds to 0.1', () => {
    const time = Array.from({ length: 30 }, (_, i) => `2026-11-14T${String(i % 24).padStart(2, '0')}:00`);
    const summary = summarizeHourly({
      time,
      precipitation: [1.04, null, 2.26, ...Array<number | null>(27).fill(0)],
      wind_gusts_10m: [10, 20, null, ...Array<number | null>(27).fill(5)],
      weather_code: Array<number | null>(30).fill(1),
    });
    expect(summary.hourly.time).toHaveLength(24);
    expect(summary.hourly.rain_mm).toHaveLength(24);
    expect(summary.hourly.gust_kmh).toHaveLength(24);
    expect(summary.hourly.rain_mm.slice(0, 3)).toEqual([1, 0, 2.3]);
    expect(summary.hourly.gust_kmh.slice(0, 3)).toEqual([10, 20, 0]);
  });
});

describe('weather context for an SOS', () => {
  it('uses the next 24 hours and exposes the initial temperature separately from rain and gusts', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('forecast_hours')).toBe('24');
      expect(url.searchParams.has('past_hours')).toBe(false);
      expect(url.searchParams.get('hourly')).toContain('temperature_2m');
      return { ok: true, json: async () => ({ hourly: {
        time: Array.from({ length: 24 }, (_, hour) => `2026-11-25T${String(hour).padStart(2, '0')}:00`),
        precipitation: Array(24).fill(2), wind_gusts_10m: Array(24).fill(30),
        weather_code: Array(24).fill(3), temperature_2m: [28, ...Array(23).fill(26)],
      } }) } as Response;
    });
    global.fetch = fetchMock as typeof fetch;
    try {
      const result = await new WeatherService().forecastAt(16.46, 107.59);
      expect(result).toMatchObject({ rain_24h_mm: 48, max_gust_kmh: 30, temperature_c: 28, horizon_hours: 24 });
    } finally { global.fetch = originalFetch; }
  });
});

describe('GDACS storm context for an SOS', () => {
  it('uses only current cyclone centres within 600 km and omits distant or inactive events', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ features: [
      { properties: { eventtype: 'TC', iscurrent: true, name: 'Bão kiểm thử', alertlevel: 'Orange' }, geometry: { type: 'Point', coordinates: [107.5, 16.5] } },
      { properties: { eventtype: 'TC', iscurrent: false, name: 'Bão cũ' }, geometry: { type: 'Point', coordinates: [107.59, 16.46] } },
    ] }) })) as typeof fetch;
    try {
      const weather = new WeatherService();
      expect(await weather.nearbyStorm(16.46, 107.59)).toMatchObject({ name: 'Bão kiểm thử', source: 'GDACS', alert_level: 'Orange' });
      expect(await weather.nearbyStorm(-9.35, 78.29)).toBeNull();
    } finally { global.fetch = originalFetch; }
  });
});

describe('validationExceptionFactory', () => {
  it('names invalid fields in Vietnamese without echoing submitted values', () => {
    const errors = [
      { property: 'name', value: undefined, constraints: { isString: 'x' } },
      { property: 'team_kind', value: 'SECRET-VALUE', constraints: { isIn: 'x' } },
      { property: 'extra', value: 1, constraints: { whitelistValidation: 'x' } },
    ] as ValidationError[];
    const error = validationExceptionFactory(errors);
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.fieldErrors).toEqual({
      name: ['Trường này là bắt buộc.'],
      team_kind: ['Giá trị không hợp lệ.'],
      extra: ['Trường này không được hỗ trợ.'],
    });
    expect(JSON.stringify(error.fieldErrors)).not.toContain('SECRET-VALUE');
  });
});
