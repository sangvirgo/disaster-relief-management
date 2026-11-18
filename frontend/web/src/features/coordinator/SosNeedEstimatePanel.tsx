import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, newCommandKey } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { Badge } from '../../components/ui/Badge';

type NeedSource = 'DECLARED' | 'ESTIMATED' | 'CONFIRMED';

interface NeedItem {
  id: string;
  item: { id: string; name: string; unit: { code: string; display_name: string; scale: number } };
  requested_quantity: string;
  status: string;
  version: number;
  source: NeedSource;
  reason_codes: string[];
  estimate?: { estimated_quantity?: string; reason_codes?: string[] } | null;
}

interface CatalogItem {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  item_type_code: string;
  unit: { code: string; display_name: string; scale: number };
}

interface SosNeedEstimatePanelProps {
  requestId: string;
  workCycle: number;
  status: string;
  peopleAffected?: number | null;
  elderlyCount?: number | null;
  needsReliefSupplies: boolean;
  onChanged: () => void;
}

// Category codes are stable API values; the labels and item-type mapping below are display-only.
const estimateCategories = [
  { code: 'WATER', label: 'Nước uống', itemType: 'NUOC_UONG' },
  { code: 'FOOD', label: 'Lương thực', itemType: 'LUONG_THUC' },
  { code: 'BLANKET', label: 'Chăn màn', itemType: 'CHAN_MEN' },
  { code: 'MEDICINE', label: 'Vật tư y tế', itemType: 'Y_TE' },
] as const;

const reasonLabels: Record<string, string> = {
  NORM_PER_PERSON_DAY: 'Tính theo định mức mỗi người mỗi ngày, nhân với số ngày.',
  NORM_PER_PERSON: 'Tính theo định mức mỗi người, dùng một lần.',
  DAYS_DEFAULT: 'Chưa nhập số ngày, hệ thống dùng mặc định 3 ngày.',
  INFANT_MODIFIER_APPLIED: 'Đã cộng thêm định mức cho trẻ nhỏ.',
  ELDERLY_MODIFIER_APPLIED: 'Đã cộng thêm định mức cho người cao tuổi.',
  ROUNDED_UP_TO_UNIT_SCALE: 'Đã làm tròn lên theo đơn vị tính của vật phẩm.',
  QUANTITY_FAR_ABOVE_ESTIMATE: 'Số lượng khai báo lớn hơn 3 lần số ước tính. Hãy kiểm tra lại trước khi xác nhận.',
};

const reviewableStatuses = ['VERIFIED', 'TRIAGED', 'DISPATCHED', 'IN_PROGRESS'];
const defaultDays = '3';
const decimalPattern = /^\d+(\.\d+)?$/u;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Không thể thực hiện thao tác. Vui lòng thử lại.';
}

function scaleStep(scale: number): string {
  return scale > 0 ? `0.${'0'.repeat(scale - 1)}1` : '1';
}

export function SosNeedEstimatePanel({
  requestId, workCycle, status, peopleAffected, elderlyCount, needsReliefSupplies, onChanged,
}: SosNeedEstimatePanelProps) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [needs, setNeeds] = useState<NeedItem[]>([]);
  const [loadError, setLoadError] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState(peopleAffected ? String(peopleAffected) : '');
  const [days, setDays] = useState(defaultDays);
  const [infants, setInfants] = useState('0');
  const [elderly, setElderly] = useState(elderlyCount ? String(elderlyCount) : '0');
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(estimateCategories.map((category) => [category.code, needsReliefSupplies])));
  const [itemChoice, setItemChoice] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [confirmError, setConfirmError] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0);

  const visible = reviewableStatuses.includes(status);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    setLoadError('');
    Promise.all([
      fetchAll<CatalogItem>('logistics', '/items'),
      api<{ items: NeedItem[] }>('logistics', `/needs?request_id=${requestId}&work_cycle=${workCycle}&limit=100`),
    ]).then(([catalog, list]) => {
      if (!live) return;
      setItems(catalog.filter((item) => item.status === 'ACTIVE'));
      setNeeds(list.items);
    }).catch((error: unknown) => {
      if (live) setLoadError(errorMessage(error));
    });
    return () => { live = false; };
  }, [visible, requestId, workCycle, revision]);

  const itemsByType = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const item of items) map.set(item.item_type_code, [...(map.get(item.item_type_code) ?? []), item]);
    return map;
  }, [items]);

  const estimated = needs.filter((need) => need.source === 'ESTIMATED' && need.status !== 'CANCELLED');
  const declaredOrConfirmed = needs.filter((need) => need.source !== 'ESTIMATED' && need.status !== 'CANCELLED');

  if (!visible) return null;

  async function generateEstimate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    const peopleCount = Number(people);
    const infantCount = Number(infants);
    const elderlyTotal = Number(elderly);
    const dayCount = Number(days);
    if (!Number.isInteger(peopleCount) || peopleCount < 1) return setFormError('Số người cần hỗ trợ phải là số nguyên từ 1 trở lên.');
    if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > 30) return setFormError('Số ngày phải từ 1 đến 30.');
    if (!Number.isInteger(infantCount) || infantCount < 0) return setFormError('Số trẻ nhỏ không hợp lệ.');
    if (!Number.isInteger(elderlyTotal) || elderlyTotal < 0) return setFormError('Số người cao tuổi không hợp lệ.');
    if (infantCount + elderlyTotal > peopleCount) return setFormError('Tổng số trẻ nhỏ và người cao tuổi không được lớn hơn số người.');

    const categories = estimateCategories
      .filter((category) => selected[category.code])
      .map((category) => {
        const choice = itemChoice[category.code] ?? itemsByType.get(category.itemType)?.[0]?.id ?? '';
        return { category: category.code, item_id: choice };
      });
    if (categories.length === 0) return setFormError('Chọn ít nhất một nhóm hàng cần ước tính.');
    if (categories.some((category) => !category.item_id)) return setFormError('Nhóm hàng đã chọn chưa có vật phẩm trong danh mục.');

    setBusy(true);
    try {
      await api('logistics', '/needs/estimate', {
        method: 'POST',
        body: {
          request_id: requestId, work_cycle: workCycle, people_count: peopleCount, days: dayCount,
          infants: infantCount, elderly: elderlyTotal, categories,
        },
        idempotencyKey: newCommandKey(),
      });
      setRevision((value) => value + 1);
      onChanged();
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmNeed(need: NeedItem) {
    const scale = need.item.unit.scale;
    const entered = (quantities[need.id] ?? need.requested_quantity).trim();
    const changed = entered !== need.requested_quantity;
    const reason = (reasons[need.id] ?? '').trim();
    setConfirmError((current) => ({ ...current, [need.id]: '' }));
    if (!decimalPattern.test(entered) || Number(entered) <= 0) {
      return setConfirmError((current) => ({ ...current, [need.id]: 'Số lượng phải là số dương.' }));
    }
    const fraction = entered.split('.')[1] ?? '';
    if (fraction.length > scale) {
      return setConfirmError((current) => ({ ...current, [need.id]: `Số lượng chỉ được có tối đa ${scale} chữ số thập phân.` }));
    }
    if (changed && !reason) {
      return setConfirmError((current) => ({ ...current, [need.id]: 'Hãy nhập lý do khi thay đổi số lượng ước tính.' }));
    }
    setBusy(true);
    try {
      await api('logistics', `/needs/${need.id}/confirm`, {
        method: 'POST',
        body: {
          expected_version: need.version,
          ...(changed ? { quantity: entered, reason } : {}),
        },
        idempotencyKey: newCommandKey(),
      });
      setRevision((value) => value + 1);
      onChanged();
    } catch (error) {
      setConfirmError((current) => ({ ...current, [need.id]: errorMessage(error) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sos-need-estimate card" aria-labelledby="sos-need-estimate-title">
      <div className="section-header">
        <h3 id="sos-need-estimate-title">Nhu cầu hàng cứu trợ</h3>
      </div>
      {loadError && <p className="sos-alert sos-alert--danger" role="alert">{loadError}</p>}

      {estimated.length > 0 && (
        <div className="sos-need-estimate__lines">
          <p className="sos-need-estimate__hint">
            Các dòng <Badge tone="info">Ước tính</Badge> chưa tính vào kho cho đến khi điều phối viên xác nhận.
          </p>
          <ul className="sos-need-estimate__list">
            {estimated.map((need) => {
              const reasonsForNeed = need.reason_codes.length ? need.reason_codes : need.estimate?.reason_codes ?? [];
              return (
                <li key={need.id} className="sos-need-estimate__row">
                  <div className="sos-need-estimate__head">
                    <strong>{need.item.name}</strong>
                    <Badge tone="info">Ước tính</Badge>
                  </div>
                  <label className="sos-need-estimate__field">
                    <span>Số lượng ({need.item.unit.display_name})</span>
                    <input
                      type="number"
                      min={scaleStep(need.item.unit.scale)}
                      step={scaleStep(need.item.unit.scale)}
                      value={quantities[need.id] ?? need.requested_quantity}
                      onChange={(event) => setQuantities((current) => ({ ...current, [need.id]: event.target.value }))}
                    />
                  </label>
                  {(quantities[need.id] ?? need.requested_quantity) !== need.requested_quantity && (
                    <label className="sos-need-estimate__field">
                      <span>Lý do điều chỉnh</span>
                      <input
                        type="text"
                        maxLength={1000}
                        value={reasons[need.id] ?? ''}
                        onChange={(event) => setReasons((current) => ({ ...current, [need.id]: event.target.value }))}
                      />
                    </label>
                  )}
                  {reasonsForNeed.length > 0 && (
                    <ul className="sos-need-estimate__reasons">
                      {reasonsForNeed.map((code) => <li key={code}>{reasonLabels[code] ?? 'Cần kiểm tra lại định mức.'}</li>)}
                    </ul>
                  )}
                  {confirmError[need.id] && <p className="sos-alert sos-alert--danger" role="alert">{confirmError[need.id]}</p>}
                  <button type="button" className="button button--primary" disabled={busy} onClick={() => void confirmNeed(need)}>
                    Xác nhận
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {declaredOrConfirmed.length > 0 && (
        <ul className="sos-need-estimate__confirmed">
          {declaredOrConfirmed.map((need) => (
            <li key={need.id}>
              <span>{need.item.name}: {need.requested_quantity} {need.item.unit.display_name}</span>{' '}
              <Badge tone="success">{need.source === 'CONFIRMED' ? 'Đã xác nhận' : 'Khai báo'}</Badge>
              {need.reason_codes.includes('QUANTITY_FAR_ABOVE_ESTIMATE') && (
                <p className="sos-alert sos-alert--warning" role="note">{reasonLabels.QUANTITY_FAR_ABOVE_ESTIMATE}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <details className="sos-need-estimate__form">
        <summary>Ước tính nhu cầu theo số người</summary>
        <form onSubmit={(event) => void generateEstimate(event)} noValidate>
          <div className="sos-need-estimate__grid">
            <label><span>Số người</span><input type="number" min={1} value={people} onChange={(event) => setPeople(event.target.value)} /></label>
            <label><span>Số ngày</span><input type="number" min={1} max={30} value={days} onChange={(event) => setDays(event.target.value)} /></label>
            <label><span>Trẻ nhỏ</span><input type="number" min={0} value={infants} onChange={(event) => setInfants(event.target.value)} /></label>
            <label><span>Người cao tuổi</span><input type="number" min={0} value={elderly} onChange={(event) => setElderly(event.target.value)} /></label>
          </div>
          <fieldset className="sos-need-estimate__categories">
            <legend>Nhóm hàng cần ước tính</legend>
            {estimateCategories.map((category) => {
              const choices = itemsByType.get(category.itemType) ?? [];
              return (
                <div key={category.code} className="sos-need-estimate__category">
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(selected[category.code])}
                      onChange={(event) => setSelected((current) => ({ ...current, [category.code]: event.target.checked }))}
                    />
                    {' '}{category.label}
                  </label>
                  {selected[category.code] && choices.length > 0 && (
                    <select
                      aria-label={`Vật phẩm cho ${category.label}`}
                      value={itemChoice[category.code] ?? choices[0]!.id}
                      onChange={(event) => setItemChoice((current) => ({ ...current, [category.code]: event.target.value }))}
                    >
                      {choices.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit.display_name})</option>)}
                    </select>
                  )}
                  {selected[category.code] && choices.length === 0 && <p className="sos-need-estimate__hint">Chưa có vật phẩm trong danh mục.</p>}
                </div>
              );
            })}
          </fieldset>
          {formError && <p className="sos-alert sos-alert--danger" role="alert">{formError}</p>}
          <button type="submit" className="button button--primary" disabled={busy}>Tạo ước tính</button>
        </form>
        {peopleAffected == null && <p className="sos-need-estimate__hint">Hồ sơ chưa có số người cần hỗ trợ; hãy nhập số người trước khi ước tính.</p>}
      </details>
    </section>
  );
}
