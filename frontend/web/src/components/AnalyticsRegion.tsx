import { useEffect, useState } from 'react';
import { api } from '../api/client';

type CampaignPage = {
  items: { id: string; name: string; region_code: string | null }[];
  more: boolean;
  cursor?: string;
};

export function useAnalyticsRegion(enabled = true, includeRequestRegions = false) {
  const [region, setRegion] = useState('');
  const [regions, setRegions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let active = true;
    async function load() {
      try {
        const found = new Set<string>();
        let cursor = '';
        // Campaigns are the scoped reader available to coordinators and managers.
        // Keep manual entry available for a region with no campaign yet.
        for (let page = 0; page < 20; page++) {
          const result = await api<CampaignPage>(
            'response',
            `/campaigns?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
          );
          for (const campaign of result.items) {
            if (campaign.region_code) found.add(campaign.region_code);
          }
          if (!result.more || !result.cursor) break;
          cursor = result.cursor;
        }
        if (includeRequestRegions) {
          cursor = '';
          for (let page = 0; page < 20; page++) {
            const result = await api<{
              items: { region_code?: string | null }[];
              more: boolean;
              cursor?: string;
            }>('response', `/requests?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
            for (const request of result.items) {
              if (request.region_code) found.add(request.region_code);
            }
            if (!result.more || !result.cursor) break;
            cursor = result.cursor;
          }
        }
        if (active) {
          const values = [...found].sort();
          setRegions(values);
          setRegion((current) => current || values[0] || '');
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Không thể tải khu vực.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [enabled, includeRequestRegions]);

  return { region, setRegion, regions, loading, error };
}

export function AnalyticsRegionField({
  region,
  onChange,
  regions,
}: {
  region: string;
  onChange: (value: string) => void;
  regions: string[];
}) {
  const [manual, setManual] = useState(false);
  const listed = regions.includes(region);
  return (
    <div className="region-control">
      <div className="region-control-heading">
        <span className="region-control-symbol" aria-hidden="true">
          ⌖
        </span>
        <span>
          <strong>Khu vực báo cáo</strong>
          <small>Chọn phạm vi để cập nhật số liệu</small>
        </span>
      </div>
      <div className="region-control-inputs">
        <label className="visually-hidden" htmlFor="analytics-region">
          Chọn khu vực báo cáo
        </label>
        <select
          id="analytics-region"
          value={listed && !manual ? region : ''}
          onChange={(event) => {
            setManual(false);
            onChange(event.target.value);
          }}
        >
          <option value="">Chọn khu vực</option>
          {regions.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="region-manual-button"
          onClick={() => setManual((value) => !value)}
        >
          {manual ? 'Ẩn nhập mã' : 'Nhập mã khác'}
        </button>
      </div>
      {manual && (
        <label className="region-manual-field">
          Mã khu vực khác
          <input
            value={region}
            onChange={(event) => onChange(event.target.value.trim())}
            placeholder="Ví dụ: DEMO_A"
            autoComplete="off"
          />
        </label>
      )}
      {regions.length > 0 && (
        <div className="region-shortcuts" role="group" aria-label="Khu vực thường dùng">
          {regions.slice(0, 4).map((code) => (
            <button
              key={code}
              type="button"
              className={region === code ? 'active' : ''}
              onClick={() => {
                setManual(false);
                onChange(code);
              }}
            >
              {code}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
