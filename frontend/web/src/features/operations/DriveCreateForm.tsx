import { useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey } from '../../api/client';

type Option = { value: string; label: string };
type DriveItem = { item_id: string; target_quantity: string; acceptance_note: string };
const emptyItem = (): DriveItem => ({ item_id: '', target_quantity: '', acceptance_note: '' });

export function DriveCreateForm({ warehouses, campaigns, items, itemScales, onSuccess }: {
  warehouses: Option[]; campaigns: Option[]; items: Option[]; itemScales: Option[]; onSuccess: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [lines, setLines] = useState<DriveItem[]>([emptyItem()]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ key: string; body: Record<string, unknown> } | null>(null);
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
    if (!pending.current) pending.current = { key: newCommandKey(), body: {
      title: title.trim().normalize('NFC'), description: description.trim().normalize('NFC'),
      intake_warehouse_id: warehouseId, ...(campaignId ? { campaign_id: campaignId } : {}),
      items: lines.map(line => ({ item_id: line.item_id, target_quantity: line.target_quantity,
        ...(line.acceptance_note.trim() ? { acceptance_note: line.acceptance_note.trim().normalize('NFC') } : {}) })),
    } };
    setBusy(true);
    try {
      await api('logistics', '/donation-drives', { method: 'POST', body: pending.current.body, idempotencyKey: pending.current.key });
      pending.current = null;
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tạo đợt quyên góp.');
    } finally { setBusy(false); }
  }
  return <form className="form-stack command-form drive-create-form" onSubmit={submit}>
    <h3>Tạo đợt quyên góp</h3>
    <label><span>Tên đợt quyên góp *</span><input required value={title} onChange={event => { setTitle(event.target.value); pending.current = null; }} /></label>
    <label><span>Mô tả *</span><textarea required value={description} onChange={event => { setDescription(event.target.value); pending.current = null; }} /></label>
    <label><span>Kho tiếp nhận *</span><select required value={warehouseId} onChange={event => { setWarehouseId(event.target.value); pending.current = null; }}>
      <option value="">Chọn kho tiếp nhận</option>{warehouses.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>
    <label><span>Chiến dịch (nếu có)</span><select value={campaignId} onChange={event => { setCampaignId(event.target.value); pending.current = null; }}>
      <option value="">Không gắn chiến dịch</option>{campaigns.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>
    <fieldset className="drive-item-list"><legend>Vật phẩm cần tiếp nhận</legend>
      {lines.map((line, index) => <div className="drive-item-row" key={index}>
        <strong>Vật phẩm {index + 1}</strong>
        <label><span>Vật phẩm *</span><select required value={line.item_id} onChange={event => updateLine(index, { item_id: event.target.value, target_quantity: '' })}>
          <option value="">Chọn vật phẩm</option>{items.filter(option => option.value === line.item_id || !lines.some(other => other.item_id === option.value)).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        <label><span>Số lượng mục tiêu *</span><input required type="number" min="0" step={10 ** -Number(itemScales.find(item => item.value === line.item_id)?.label ?? 0)} value={line.target_quantity} onChange={event => updateLine(index, { target_quantity: event.target.value })} /></label>
        <label><span>Ghi chú tiếp nhận (nếu có)</span><input value={line.acceptance_note} onChange={event => updateLine(index, { acceptance_note: event.target.value })} /></label>
        {lines.length > 1 && <button className="button secondary" type="button" onClick={() => { setLines(current => current.filter((_, i) => i !== index)); pending.current = null; }}>Xóa vật phẩm này</button>}
      </div>)}
      <button className="button secondary" type="button" disabled={lines.length >= Math.min(50, items.length)} onClick={() => { setLines(current => [...current, emptyItem()]); pending.current = null; }}>+ Thêm vật phẩm</button>
    </fieldset>
    {error && <p className="notice error" role="alert">{error}</p>}
    <button className="button" disabled={busy}>{busy ? 'Đang tạo…' : 'Tạo đợt quyên góp'}</button>
  </form>;
}
