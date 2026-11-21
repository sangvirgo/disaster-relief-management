import { Dropdown } from '../../components/ui/Dropdown';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';

type Item = { id: string; name: string; unit: { display_name: string; scale: number } };
type Drive = { items: { item_id: string; item_name: string; unit_name: string; scale: number }[] };
type Line = {
  item_id: string;
  counted_quantity: string;
  accepted_quantity: string;
  held_quantity: string;
  rejected_quantity: string;
  condition_note: string;
  expiry_date: string;
};
const empty = (): Line => ({
  item_id: '',
  counted_quantity: '',
  accepted_quantity: '',
  held_quantity: '0',
  rejected_quantity: '0',
  condition_note: '',
  expiry_date: '',
});
const normalizeQuantity = (value?: string) => value?.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');

type Existing = { lines?: (Partial<Line> & { item_name?: string; unit_name?: string; unit_scale?: number | string })[] } | null;

export function ReceiptCountForm({
  receiptId,
  create,
  driveId,
  version,
  existing,
  heldRelease = false,
  confirm,
  onSuccess,
}: {
  receiptId: string;
  /** When there is no receipt yet, it is created from this delivery and warehouse right before the first count is sent. */
  create?: { deliveryId: string; warehouseId: string };
  driveId: string;
  driveTitle: string;
  version: number;
  existing: Existing;
  heldRelease?: boolean;
  /** Independent second count: the figures are compared with the recorded count and a match approves the receipt. */
  confirm?: { countRevision: number; declarationRevision: number };
  onSuccess: (result?: { confirmation?: { matched: boolean; posted?: boolean; mismatched_items: string[] } }) => void;
}) {
  const [driveItems, setDriveItems] = useState<Item[]>([]);
  const [catalogItems, setCatalogItems] = useState<Item[]>([]);
  const [allowUnexpected, setAllowUnexpected] = useState(false);
  const [driveLoading, setDriveLoading] = useState(true);
  const [driveRevision, setDriveRevision] = useState(0);
  const [lines, setLines] = useState<Line[]>(
    existing?.lines?.length
      ? existing.lines.map((line) => ({
          item_id: line.item_id || '',
          counted_quantity: normalizeQuantity(line.counted_quantity) || '',
          accepted_quantity: normalizeQuantity(line.accepted_quantity) || '',
          held_quantity: normalizeQuantity(line.held_quantity) || '0',
          rejected_quantity: normalizeQuantity(line.rejected_quantity) || '0',
          condition_note: line.condition_note || '',
          expiry_date: line.expiry_date || '',
        }))
      : [empty()]
  );
  const [note, setNote] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState('');
  const [itemsError, setItemsError] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const key = useRef<string | null>(null);
  const existingItems: Item[] = (existing?.lines || []).filter(line => line.item_id).map(line => ({
    id: line.item_id!, name: line.item_name || line.item_id!,
    unit: { display_name: line.unit_name || '', scale: Number(line.unit_scale ?? 0) },
  }));
  const visibleCatalog = catalogItems.filter(item => allowUnexpected || lines.some(line => line.item_id === item.id));
  const items = [...driveItems, ...existingItems.filter(item => !driveItems.some(driveItem => driveItem.id === item.id)),
    ...visibleCatalog.filter(item => !driveItems.some(driveItem => driveItem.id === item.id) && !existingItems.some(existingItem => existingItem.id === item.id))];
  const fieldErrors: Record<string, string> = {};
  const seenItems = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const itemKey = `${index}.item_id`;
    if (!line.item_id.trim()) fieldErrors[itemKey] = 'Mã vật phẩm là bắt buộc.';
    else if (line.item_id.trim().length > 36) fieldErrors[itemKey] = 'Mã vật phẩm không được vượt quá 36 ký tự.';
    else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line.item_id.trim()))
      fieldErrors[itemKey] = 'Mã vật phẩm không đúng định dạng.';
    else if (seenItems.has(line.item_id.trim())) fieldErrors[itemKey] = 'Mỗi vật phẩm chỉ được xuất hiện một lần.';
    if (line.item_id.trim()) seenItems.add(line.item_id.trim());
    const item = items.find((candidate) => candidate.id === line.item_id);
    const previous = existing?.lines?.[index];
    if (heldRelease && previous && Number(line.accepted_quantity) < Number(previous.accepted_quantity || 0))
      fieldErrors[`${index}.accepted_quantity`] = 'Không được giảm phần đã tiếp nhận ở phiếu đã ghi sổ.';
    if (heldRelease && previous && Number(line.held_quantity) > Number(previous.held_quantity || 0))
      fieldErrors[`${index}.held_quantity`] = 'Chỉ được chuyển phần tạm giữ sang tiếp nhận; không được tăng số tạm giữ.';
    for (const [field, title] of [
      ['counted_quantity', 'Số đã đếm'],
      ['accepted_quantity', 'Số tiếp nhận'],
      ['held_quantity', 'Số tạm giữ'],
      ['rejected_quantity', 'Số từ chối'],
    ] as const) {
      const quantity = line[field].trim();
      const errorKey = `${index}.${field}`;
      if (!quantity) fieldErrors[errorKey] = `${title} là bắt buộc.`;
      else if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(quantity)) fieldErrors[errorKey] = `${title} phải là số không âm.`;
      else if (item && (quantity.split('.')[1]?.length || 0) > item.unit.scale)
        fieldErrors[errorKey] = item.unit.scale === 0 ? `${title} phải là số nguyên theo đơn vị ${item.unit.display_name}.` : `${title} chỉ được có tối đa ${item.unit.scale} chữ số thập phân.`;
    }
    if (line.condition_note.length > 1000)
      fieldErrors[`${index}.condition_note`] = 'Ghi chú tình trạng không được vượt quá 1.000 ký tự.';
    const quantities = [line.counted_quantity, line.accepted_quantity, line.held_quantity, line.rejected_quantity];
    if (quantities.every((quantity) => quantity.trim() && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(quantity.trim())) &&
      Math.abs(Number(line.counted_quantity) - Number(line.accepted_quantity) - Number(line.held_quantity) - Number(line.rejected_quantity)) > 1e-9)
      fieldErrors[`${index}.counted_quantity`] = 'Số đã đếm phải bằng số tiếp nhận cộng số tạm giữ và số từ chối.';
  }
  if (note.length > 1000) fieldErrors.note = 'Ghi chú chung không được vượt quá 1.000 ký tự.';
  if (heldRelease && !lines.some((line, index) => Number(line.accepted_quantity) > Number(existing?.lines?.[index]?.accepted_quantity || 0)))
    fieldErrors.note = 'Cần chuyển ít nhất một phần hàng tạm giữ sang tiếp nhận trước khi gửi duyệt bổ sung.';
  const hasInvalidFields = Object.keys(fieldErrors).length > 0;
  function showFieldError(field: string, value: string) {
    return attempted || touched[field] || Boolean(value);
  }
  useEffect(() => {
    let live = true;
    setDriveLoading(true);
    fetchAll<Drive & { id: string }>('logistics', '/donation-drives')
      .then(drives => { if (!live) return; const drive = drives.find(candidate => candidate.id === driveId);
        if (!drive) throw new Error('Không tìm thấy đợt quyên góp của biên nhận trong phạm vi được cấp quyền.');
        if (!existing?.lines?.length && !heldRelease) setLines(drive.items.map(item => ({ ...empty(), item_id: item.item_id })));
        setDriveItems(drive.items.map(item => ({
        id: item.item_id, name: item.item_name,
        unit: { display_name: item.unit_name, scale: Number(item.scale) },
      }))); })
      .catch(cause => { if (live) setItemsError(cause instanceof Error ? cause.message : 'Không tải được vật phẩm của đợt quyên góp.'); })
      .finally(() => { if (live) setDriveLoading(false); });
    return () => { live = false; };
  }, [driveId, driveRevision]);
  useEffect(() => {
    if (!allowUnexpected) return;
    let live = true;
    fetchAll<Item>('logistics', '/items?status=ACTIVE')
      .then(value => { if (live) setCatalogItems(value); })
      .catch(cause => { if (live) setItemsError(cause instanceof Error ? cause.message : 'Không tải được danh mục vật phẩm.'); });
    return () => { live = false; };
  }, [allowUnexpected]);
  function edit(index: number, field: keyof Line, value: string) {
    setLines((current) =>
      current.map((line, position) => {
        if (position !== index) return line;
        const next = { ...line, [field]: value };
        // Typical case: everything counted is accepted. Keep accepted in step until the user edits the split.
        if (field === 'counted_quantity' && !heldRelease && !touched[`${index}.accepted_quantity`] && Number(line.held_quantity || 0) === 0 && Number(line.rejected_quantity || 0) === 0) next.accepted_quantity = value;
        return next;
      })
    );
    setTouched((current) => ({ ...current, [`${index}.${field}`]: true }));
    key.current = null;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (hasInvalidFields) return;
    setError('');
    setBusy(true);
    try {
      key.current ||= newCommandKey();
      let targetReceipt = receiptId;
      let targetVersion = version;
      if (create && !receiptId) {
        const created = await api<{ id: string; version: number }>('logistics', '/donation-receipts', {
          method: 'POST', idempotencyKey: `${key.current}-receipt`,
          body: { delivery_id: create.deliveryId, warehouse_id: create.warehouseId },
        });
        targetReceipt = created.id;
        targetVersion = Number(created.version);
      }
      const result = await api<{ confirmation?: { matched: boolean; mismatched_items: string[] } }>('logistics', `/donation-receipts/${encodeURIComponent(targetReceipt)}/${confirm ? 'confirmations' : 'counts'}`, {
        method: 'POST',
        idempotencyKey: key.current,
        body: {
          expected_version: targetVersion,
          ...(confirm ? { count_revision: confirm.countRevision, declaration_revision: confirm.declarationRevision } : {}),
          lines: lines.map((line) => ({
            item_id: line.item_id.trim(),
            counted_quantity: line.counted_quantity,
            accepted_quantity: line.accepted_quantity,
            held_quantity: line.held_quantity,
            rejected_quantity: line.rejected_quantity,
            ...(line.condition_note.trim() ? { condition_note: line.condition_note.trim() } : {}),
            ...(line.expiry_date ? { expiry_date: line.expiry_date } : {}),
          })),
          ...(note.trim() && !confirm ? { note: note.trim() } : {}),
        },
      });
      key.current = null;
      onSuccess(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa xác nhận được kết quả kiểm đếm.');
    } finally {
      setBusy(false);
    }
  }
  const simple = !advanced && !heldRelease;
  return (
    <form className="form-stack command-form" onSubmit={submit} noValidate>
      <h3>{heldRelease ? 'Kiểm tra lại hàng tạm giữ' : confirm ? 'Xác nhận kiểm đếm độc lập' : 'Gửi kết quả kiểm đếm'}</h3>
      <p>{confirm ? 'Tự đếm hàng thực tế rồi nhập số đếm được. Nếu khớp lần đếm trước, biên nhận được duyệt và ghi sổ ngay.' : heldRelease ? 'Chỉ tăng phần tiếp nhận và giảm tương ứng phần tạm giữ.' : 'Nhập số lượng đếm được cho từng vật phẩm.'}</p>
      {driveLoading && <p role="status">Đang tải vật phẩm của đợt quyên góp…</p>}
      {itemsError && (
        <p className="notice error" role="alert">
          {itemsError}
        </p>
      )}
      {!driveLoading && !driveItems.length && <button className="button secondary" type="button" onClick={() => { setItemsError(''); setDriveRevision(current => current + 1); }}>Tải lại vật phẩm của đợt</button>}
      {!simple && !heldRelease && <button className="button secondary" type="button" aria-expanded={allowUnexpected} onClick={() => { setAllowUnexpected(current => !current); setItemsError(''); }}>
        {allowUnexpected ? 'Ẩn vật phẩm ngoài đợt' : 'Có vật phẩm thực tế ngoài đợt quyên góp?'}
      </button>}
      {allowUnexpected && !heldRelease && <p className="notice warning">Chỉ chọn vật phẩm ngoài đợt khi hàng thực tế được bàn giao khác danh sách của đợt. Dòng này sẽ được đánh dấu để người duyệt rà soát.</p>}
      {simple && lines.map((line, index) => {
        const item = items.find((candidate) => candidate.id === line.item_id);
        return (
          <label key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: '12px', alignItems: 'center' }}>
            <span>{item ? `${item.name} (${item.unit.display_name})` : 'Vật phẩm'}</span>
            <input type="number" min="0" step="any" inputMode="decimal" placeholder="Số đếm được" value={line.counted_quantity}
              aria-invalid={Boolean(fieldErrors[`${index}.counted_quantity`] && (attempted || touched[`${index}.counted_quantity`]))}
              onChange={(event) => edit(index, 'counted_quantity', event.target.value)} />
            {(attempted || touched[`${index}.counted_quantity`]) && (fieldErrors[`${index}.counted_quantity`] || fieldErrors[`${index}.accepted_quantity`]) &&
              <small className="field-error" role="alert" style={{ gridColumn: '1 / -1' }}>{fieldErrors[`${index}.counted_quantity`] || fieldErrors[`${index}.accepted_quantity`]}</small>}
          </label>
        );
      })}
      {!heldRelease && <button className="button secondary" type="button" aria-expanded={advanced} onClick={() => setAdvanced((value) => !value)}>
        {advanced ? 'Thu gọn' : 'Có hàng lỗi, giữ lại hoặc cần ghi chú?'}
      </button>}
      {!simple && lines.map((line, index) => (
        <fieldset className="candidate count-line" key={index}>
          <legend>Vật phẩm {index + 1}</legend>
          <label>
            Vật phẩm trong đợt quyên góp
            <Dropdown
              disabled={heldRelease}
              value={items.some((item) => item.id === line.item_id) ? line.item_id : ''}
              onChange={(event) => edit(index, 'item_id', event.target.value)}
            >
              <option value="">Chọn vật phẩm</option>
              {items.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name} · {item.unit.display_name}{!driveItems.some(driveItem => driveItem.id === item.id) ? ' · ngoài đợt' : ''}
                </option>
              ))}
            </Dropdown>
          </label>
          {(allowUnexpected || heldRelease) && <label>
            <span>Mã vật phẩm <span className="required-mark" aria-hidden="true">*</span></span>
            <input
              required
              readOnly={heldRelease}
              maxLength={37}
              aria-invalid={Boolean(showFieldError(`${index}.item_id`, line.item_id) && fieldErrors[`${index}.item_id`])}
              value={line.item_id}
              onChange={(event) => edit(index, 'item_id', event.target.value)}
              onBlur={() => setTouched((current) => ({ ...current, [`${index}.item_id`]: true }))}
              placeholder="Mã vật phẩm trong danh mục"
            />
            {showFieldError(`${index}.item_id`, line.item_id) && fieldErrors[`${index}.item_id`] && <small className="field-error" role="alert">{fieldErrors[`${index}.item_id`]}</small>}
          </label>}
          {!allowUnexpected && !heldRelease && showFieldError(`${index}.item_id`, line.item_id) && fieldErrors[`${index}.item_id`] && <small className="field-error" role="alert">{fieldErrors[`${index}.item_id`]}</small>}
          <div className="form-grid">
            {(
              [
                ['counted_quantity', 'Đã đếm'],
                ['accepted_quantity', 'Tiếp nhận'],
                ['held_quantity', 'Tạm giữ'],
                ['rejected_quantity', 'Từ chối'],
              ] as const
            ).map(([field, title]) => (
              <label key={field}>
                <span>{title} <span className="required-mark" aria-hidden="true">*</span></span>
                <input
                  required
                  type="number"
                  readOnly={heldRelease && ['counted_quantity', 'rejected_quantity'].includes(field)}
                  min="0"
                  step="any"
                  aria-invalid={Boolean(showFieldError(`${index}.${field}`, line[field]) && fieldErrors[`${index}.${field}`])}
                  value={line[field]}
                  onChange={(event) => edit(index, field, event.target.value)}
                  onBlur={() => setTouched((current) => ({ ...current, [`${index}.${field}`]: true }))}
                />
                {showFieldError(`${index}.${field}`, line[field]) && fieldErrors[`${index}.${field}`] && <small className="field-error" role="alert">{fieldErrors[`${index}.${field}`]}</small>}
              </label>
            ))}
          </div>
          <label>
            Ghi chú tình trạng
            <input
              maxLength={1001}
              aria-invalid={Boolean(showFieldError(`${index}.condition_note`, line.condition_note) && fieldErrors[`${index}.condition_note`])}
              value={line.condition_note}
              onChange={(event) => edit(index, 'condition_note', event.target.value)}
              onBlur={() => setTouched((current) => ({ ...current, [`${index}.condition_note`]: true }))}
            />
            {showFieldError(`${index}.condition_note`, line.condition_note) && fieldErrors[`${index}.condition_note`] && <small className="field-error" role="alert">{fieldErrors[`${index}.condition_note`]}</small>}
          </label>
          <label>
            Hạn sử dụng nếu có
            <input
              type="date"
              value={line.expiry_date}
              onChange={(event) => edit(index, 'expiry_date', event.target.value)}
            />
          </label>
          {!heldRelease && lines.length > 1 && (
            <button
              className="button secondary"
              type="button"
              onClick={() => {
                setLines(lines.filter((_, position) => position !== index));
                key.current = null;
              }}
            >
              Bỏ dòng này
            </button>
          )}
        </fieldset>
      ))}
      {!simple && !heldRelease && lines.length < 50 && (
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            setLines([...lines, empty()]);
            key.current = null;
          }}
        >
          Thêm vật phẩm
        </button>
      )}
      {!simple && <label>
        Ghi chú chung
        <textarea
          maxLength={1001}
          aria-invalid={Boolean(showFieldError('note', note) && fieldErrors.note)}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setTouched((current) => ({ ...current, note: true }));
            key.current = null;
          }}
          onBlur={() => setTouched((current) => ({ ...current, note: true }))}
        />
        {showFieldError('note', note) && fieldErrors.note && <small className="field-error" role="alert">{fieldErrors.note}</small>}
      </label>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button className="button" disabled={busy || driveLoading || !driveItems.length || hasInvalidFields}>
        {busy ? 'Đang gửi…' : confirm ? 'Gửi xác nhận' : 'Gửi kết quả đếm'}
      </button>
    </form>
  );
}
