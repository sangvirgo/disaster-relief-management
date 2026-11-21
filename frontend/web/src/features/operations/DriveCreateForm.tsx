import { Dropdown } from '../../components/ui/Dropdown';
import { useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey } from '../../api/client';
import { LocationPicker, type Point } from '../../maps/LocationPicker';

type Option = { value: string; label: string };
type DriveItem = { item_id: string; target_quantity: string; acceptance_note: string };
const emptyItem = (): DriveItem => ({ item_id: '', target_quantity: '', acceptance_note: '' });

export type DriveEdit = {
  id: string; version: number;
  initial: { title: string; description: string; campaignId: string; opensAt: string | null; closesAt: string | null; lines: DriveItem[]; location?: Point | null; locationNote?: string };
};
export type WarehouseArea = { name: string; latitude: number; longitude: number; radiusM: number };
/** Great-circle distance in metres (same overlap test the server applies with ST_DWithin). */
export function distanceMetres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.latitude - a.latitude) * rad) / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(((b.longitude - a.longitude) * rad) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
const toLocalInput = (iso: string | null) => iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : '';
const toIso = (local: string) => local ? new Date(local).toISOString() : null;

/** Creates a donation drive, or (with `edit`) adjusts a DRAFT one. `lockedWarehouseId` fixes the receiving warehouse. */
export function DriveCreateForm({ warehouses, campaigns, items, itemScales, onSuccess, lockedWarehouseId, edit, areaFor, initialLocation }: {
  warehouses: Option[]; campaigns: Option[]; items: Option[]; itemScales: Option[]; onSuccess: () => void;
  lockedWarehouseId?: string; edit?: DriveEdit;
  /** Service area of a warehouse; the drop-off point must lie inside it. */
  areaFor: (warehouseId: string) => WarehouseArea | null;
  initialLocation?: Point | null;
}) {
  const [title, setTitle] = useState(edit?.initial.title ?? '');
  const [description, setDescription] = useState(edit?.initial.description ?? '');
  const [warehouseId, setWarehouseId] = useState(lockedWarehouseId ?? '');
  const [campaignId, setCampaignId] = useState(edit?.initial.campaignId ?? '');
  const [opensAt, setOpensAt] = useState(toLocalInput(edit?.initial.opensAt ?? null));
  const [closesAt, setClosesAt] = useState(toLocalInput(edit?.initial.closesAt ?? null));
  const [location, setLocation] = useState<Point | null>(edit?.initial.location ?? initialLocation ?? null);
  const [locationNote, setLocationNote] = useState(edit?.initial.locationNote ?? '');
  const area = warehouseId ? areaFor(warehouseId) : null;
  const locationError = !warehouseId ? '' : !area ? 'Kho này chưa có vùng phục vụ. Hãy sửa kho để chọn vị trí và bán kính trước.'
    : !location ? 'Hãy chọn vị trí điểm quyên góp trên bản đồ.'
    : distanceMetres(area, location) > area.radiusM ? `Vị trí phải nằm trong vùng phục vụ của ${area.name} (bán kính ${(area.radiusM / 1000).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} km).` : '';
  const [lines, setLines] = useState<DriveItem[]>(edit?.initial.lines.length ? edit.initial.lines : [emptyItem()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ key: string; body: Record<string, unknown> } | null>(null);
  const lineErrors = lines.map(line => {
    const scale = Number(itemScales.find(item => item.value === line.item_id)?.label ?? 0);
    const quantity = Number(line.target_quantity);
    const duplicate = Boolean(line.item_id && lines.filter(other => other.item_id === line.item_id).length > 1);
    const quantityError = !line.target_quantity.trim() ? 'Số lượng mục tiêu là bắt buộc.'
      : !Number.isFinite(quantity) || quantity <= 0 || !/^\d+(?:\.\d+)?$/.test(line.target_quantity)
        || (line.target_quantity.split('.')[1]?.replace(/0+$/, '').length || 0) > scale
        ? `Số lượng mục tiêu phải lớn hơn 0 và có tối đa ${scale} chữ số thập phân theo đơn vị vật phẩm.` : '';
    return {
      item: !line.item_id ? 'Vật phẩm là bắt buộc.' : duplicate ? 'Mỗi vật phẩm chỉ được thêm một lần.' : '',
      quantity: quantityError,
      note: line.acceptance_note.length > 500 ? 'Ghi chú tiếp nhận không được vượt quá 500 ký tự.' : '',
    };
  });
  const hasInvalidLines = !lines.length || lineErrors.some(line => Boolean(line.item || line.quantity || line.note));
  const hasInvalidFields = !title.trim() || title.length > 200 || !description.trim() || description.length > 5000
    || !warehouseId || hasInvalidLines || Boolean(locationError);
  function updateLine(index: number, patch: Partial<DriveItem>) {
    setLines(current => current.map((line, i) => i === index ? { ...line, ...patch } : line));
    setError('');
    pending.current = null;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (lines.some(line => !line.item_id || !line.target_quantity)) {
      setError('Hãy chọn vật phẩm và nhập số lượng mục tiêu cho từng dòng.'); return;
    }
    if (new Set(lines.map(line => line.item_id)).size !== lines.length) {
      setError('Mỗi vật phẩm chỉ được thêm một lần.'); return;
    }
    for (const line of lines) {
      const scale = Number(itemScales.find(item => item.value === line.item_id)?.label ?? 0);
      const quantity = Number(line.target_quantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || !/^\d+(?:\.\d+)?$/.test(line.target_quantity) ||
        (line.target_quantity.split('.')[1]?.replace(/0+$/, '').length || 0) > scale) {
        setError(`Số lượng mục tiêu phải lớn hơn 0 và có tối đa ${scale} chữ số thập phân theo đơn vị vật phẩm.`); return;
      }
    }
    if (locationError || !location) { setError(locationError || 'Hãy chọn vị trí điểm quyên góp.'); return; }
    if (opensAt && closesAt && new Date(closesAt) <= new Date(opensAt)) { setError('Thời điểm kết thúc phải sau thời điểm bắt đầu.'); return; }
    const itemBody = lines.map(line => ({ item_id: line.item_id, target_quantity: line.target_quantity,
      ...(line.acceptance_note.trim() ? { acceptance_note: line.acceptance_note.trim().normalize('NFC') } : {}) }));
    if (!pending.current) pending.current = { key: newCommandKey(), body: edit ? {
      expected_version: edit.version, title: title.trim().normalize('NFC'), description: description.trim().normalize('NFC'),
      campaign_id: campaignId || null, opens_at: toIso(opensAt), closes_at: toIso(closesAt), items: itemBody,
      location: { type: 'Point', coordinates: [location.longitude, location.latitude] }, location_note: locationNote.trim() ? locationNote.trim().normalize('NFC') : null,
    } : {
      title: title.trim().normalize('NFC'), description: description.trim().normalize('NFC'),
      intake_warehouse_id: warehouseId, ...(campaignId ? { campaign_id: campaignId } : {}),
      ...(opensAt ? { opens_at: toIso(opensAt) } : {}), ...(closesAt ? { closes_at: toIso(closesAt) } : {}),
      location: { type: 'Point', coordinates: [location.longitude, location.latitude] },
      ...(locationNote.trim() ? { location_note: locationNote.trim().normalize('NFC') } : {}),
      items: itemBody,
    } };
    setBusy(true);
    try {
      await api('logistics', edit ? `/donation-drives/${edit.id}` : '/donation-drives', { method: edit ? 'PATCH' : 'POST', body: pending.current.body, idempotencyKey: pending.current.key });
      pending.current = null;
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tạo đợt quyên góp.');
    } finally { setBusy(false); }
  }
  return <form className="form-stack command-form drive-create-form" onSubmit={submit}>
    <label><span>Tên đợt quyên góp *</span><input required maxLength={201} aria-invalid={title.length > 200} value={title} onChange={event => { setTitle(event.target.value); pending.current = null; }} />{title.length > 200 && <small className="field-error" role="alert">Tên đợt quyên góp không được vượt quá 200 ký tự.</small>}</label>
    <label><span>Mô tả *</span><textarea required maxLength={5001} aria-invalid={description.length > 5000} value={description} onChange={event => { setDescription(event.target.value); pending.current = null; }} />{description.length > 5000 && <small className="field-error" role="alert">Mô tả không được vượt quá 5.000 ký tự.</small>}</label>
    <div className="form-grid-2">
    <label><span>Kho tiếp nhận *</span><Dropdown required disabled={Boolean(lockedWarehouseId || edit)} value={warehouseId} onChange={event => { setWarehouseId(event.target.value); pending.current = null; }}>
      <option value="">Chọn kho tiếp nhận</option>{warehouses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </Dropdown></label>
    <label><span>Chiến dịch (nếu có)</span><Dropdown value={campaignId} onChange={event => { setCampaignId(event.target.value); pending.current = null; }}>
      <option value="">Không gắn chiến dịch</option>{campaigns.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </Dropdown></label>
    </div>
    <fieldset className="drive-location-field"><legend>Điểm quyên góp trên bản đồ *</legend>
      <small className="muted">Chọn nơi người dân mang hàng đến. Vòng tròn trên bản đồ là vùng phục vụ của kho; điểm phải nằm trong vòng đó. Người quyên góp sẽ được gợi ý đợt gần họ nhất.</small>
      <LocationPicker value={location} initiallyOpen={Boolean(warehouseId) && !location} toggleLabel={location ? 'Đổi điểm quyên góp' : undefined}
        overlay={area ? { areas: [{ id: 'warehouse-area', label: `Vùng phục vụ ${area.name}`, latitude: area.latitude, longitude: area.longitude, radiusM: area.radiusM }] } : undefined}
        onSelect={(point, address) => { setLocation(point); if (point && address && !locationNote) setLocationNote(address); pending.current = null; setError(''); }} />
      {location && <small>Đã chọn điểm quyên góp trên bản đồ.</small>}
      {warehouseId && locationError && <small className="field-error" role="alert">{locationError}</small>}
      <label><span>Chỉ dẫn tìm điểm (nếu có)</span><input maxLength={501} value={locationNote} onChange={event => { setLocationNote(event.target.value); pending.current = null; }} placeholder="Ví dụ: cổng chính nhà văn hóa, sảnh tầng 1" /></label>
    </fieldset>
    <div className="form-grid-2">
    <label><span>Bắt đầu nhận hàng (nếu có)</span><input type="datetime-local" value={opensAt} onChange={event => { setOpensAt(event.target.value); pending.current = null; }} /></label>
    <label><span>Hạn nhận hàng (nếu có)</span><input type="datetime-local" value={closesAt} onChange={event => { setClosesAt(event.target.value); pending.current = null; }} /></label>
    </div>
    <fieldset className="drive-item-list"><legend>Vật phẩm cần tiếp nhận</legend>
      {lines.map((line, index) => <div className="drive-item-row" key={index}>
        <div className="drive-item-head"><strong>Vật phẩm {index + 1}</strong>
          {lines.length > 1 && <button className="button secondary small" type="button" onClick={() => { setLines(current => current.filter((_, i) => i !== index)); pending.current = null; }}>Xóa</button>}</div>
        <div className="drive-item-fields">
        <label><Dropdown required aria-label="Vật phẩm" aria-invalid={Boolean(lineErrors[index].item)} value={line.item_id} onChange={event => updateLine(index, { item_id: event.target.value, target_quantity: '' })}>
          <option value="">Chọn vật phẩm</option>{items.filter(option => option.value === line.item_id || !lines.some(other => other.item_id === option.value)).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Dropdown>{line.item_id && lineErrors[index].item && <small className="field-error" role="alert">{lineErrors[index].item}</small>}</label>
        <label><span>Số lượng mục tiêu *</span><input required type="number" min="0" step={10 ** -Number(itemScales.find(item => item.value === line.item_id)?.label ?? 0)} aria-invalid={Boolean(line.target_quantity && lineErrors[index].quantity)} value={line.target_quantity} onChange={event => updateLine(index, { target_quantity: event.target.value })} />{line.target_quantity && lineErrors[index].quantity && <small className="field-error" role="alert">{lineErrors[index].quantity}</small>}</label>
        <label><span>Ghi chú tiếp nhận (nếu có)</span><input maxLength={501} aria-invalid={Boolean(lineErrors[index].note)} value={line.acceptance_note} onChange={event => updateLine(index, { acceptance_note: event.target.value })} />{lineErrors[index].note && <small className="field-error" role="alert">{lineErrors[index].note}</small>}</label>
        </div>
      </div>)}
      <button className="button secondary" type="button" disabled={lines.length >= Math.min(50, items.length)} onClick={() => { setLines(current => [...current, emptyItem()]); pending.current = null; }}>+ Thêm vật phẩm</button>
    </fieldset>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="form-actions"><button className="button" disabled={busy || hasInvalidFields}>{busy ? (edit ? 'Đang lưu…' : 'Đang tạo…') : (edit ? 'Lưu thay đổi' : 'Tạo đợt quyên góp')}</button>{hasInvalidFields && !busy && <span className="muted">Điền đủ tên, mô tả, kho, vị trí trong vùng phục vụ và vật phẩm.</span>}</div>
  </form>;
}
