import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { regionName } from '../i18n/labels';

type CampaignPage = {
  items: { id: string; name: string; region_code: string | null }[];
  more: boolean;
  cursor?: string;
};

export function useAnalyticsRegion(enabled = true, includeRequestRegions = false, autoSelect = true, storageKey?: string) {
  const [region, setRegion] = useState(() => {
    try { return storageKey ? window.sessionStorage.getItem(storageKey) || '' : ''; } catch { return ''; }
  });
  useEffect(() => {
    if (!storageKey) return;
    try { window.sessionStorage.setItem(storageKey, region); } catch { /* Filtering still works without storage. */ }
  }, [region, storageKey]);
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
          if (page === 19 && result.more) throw new Error('Danh sách chiến dịch quá dài để xác định đủ khu vực. Vui lòng chọn khu vực cụ thể.');
          if (result.more && !result.cursor) throw new Error('Danh sách chiến dịch thiếu mã trang tiếp theo. Vui lòng thử lại.');
          if (!result.more) break;
          cursor = result.cursor!;
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
            if (page === 19 && result.more) throw new Error('Danh sách SOS quá dài để xác định đủ khu vực. Vui lòng chọn khu vực cụ thể.');
            if (result.more && !result.cursor) throw new Error('Danh sách SOS thiếu mã trang tiếp theo. Vui lòng thử lại.');
            if (!result.more) break;
            cursor = result.cursor!;
          }
        }
        if (active) {
          const values = [...found].sort();
          setRegions(values);
          if (autoSelect) setRegion((current) => current || values[0] || '');
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
  }, [enabled, includeRequestRegions, autoSelect]);

  return { region, setRegion, regions, loading, error };
}

export function AnalyticsRegionField({
  region,
  onChange,
  regions,
  id = 'analytics-region',
  title = 'Khu vực báo cáo',
  hint = 'Chọn phạm vi để cập nhật số liệu',
  allowAll = false,
}: {
  region: string;
  onChange: (value: string) => void;
  regions: string[];
  id?: string;
  title?: string;
  hint?: string;
  allowAll?: boolean;
}) {
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftTouched, setDraftTouched] = useState(false);
  const [draftAttempted, setDraftAttempted] = useState(false);
  const draftError = draft.trim() && !/^[A-Z0-9_]{2,32}$/.test(draft.trim())
    ? 'Mã khu vực cần 2–32 ký tự, gồm chữ in hoa, số hoặc dấu gạch dưới.' : '';
  const listed = regions.includes(region);
  return (
    <div className="region-control">
      <div className="region-control-heading">
        <span className="region-control-symbol" aria-hidden="true">
          ⌖
        </span>
        <span>
          <strong>{title}</strong>
          <small>{hint}</small>
        </span>
      </div>
      <div className="region-control-inputs">
        <label className="visually-hidden" htmlFor={id}>
          Chọn {title.toLowerCase()}
        </label>
        <select
          id={id}
          disabled={manual}
          value={!manual ? region : ''}
          onChange={(event) => {
            setManual(false);
            onChange(event.target.value);
          }}
        >
          <option value="">{manual ? 'Đang nhập mã khu vực' : allowAll ? 'Toàn Việt Nam' : 'Chọn khu vực'}</option>
          {region && !listed && <option value={region}>{regionName(region)} · mã đã nhập</option>}
          {regions.map((code) => (
            <option key={code} value={code}>
              {regionName(code)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="region-manual-button"
          onClick={() => {
            if (manual && region && !listed) onChange(allowAll ? '' : regions[0] || '');
            if (!manual) setDraft(region && !listed ? region : '');
            setManual((value) => !value);
          }}
        >
          {manual ? 'Ẩn nhập mã' : 'Nhập mã khác'}
        </button>
      </div>
      {manual && (
        <form className="region-manual-field" noValidate onSubmit={(event) => {
          event.preventDefault();
          setDraftAttempted(true);
          if (draft.trim() && !draftError) onChange(draft.trim());
        }}>
          <label htmlFor={`${id}-manual`}>Mã khu vực khác</label>
          <div className="region-control-inputs">
            <input
              id={`${id}-manual`}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setDraftTouched(true);
              }}
              onBlur={() => setDraftTouched(true)}
              aria-invalid={Boolean((draftTouched || draftAttempted) && draftError)}
              placeholder="Ví dụ: DEMO_A"
              autoComplete="off"
              maxLength={33}
            />
            <button type="submit" className="region-manual-button" disabled={!draft.trim() || Boolean(draftError) || draft.trim() === region}>Áp dụng</button>
          </div>
          {(draftTouched || draftAttempted) && draftError && <small className="field-error" role="alert">{draftError}</small>}
        </form>
      )}
      {region && !listed && <small>Khu vực này chưa có trong danh sách của tài khoản. Kết quả rỗng có thể do giới hạn quyền xem; hãy xác nhận phạm vi trước khi dùng số liệu.</small>}
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
              {regionName(code)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
