import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';

type Item = { id: string; name: string; unit: { display_name: string; scale: number } };
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

type Existing = { lines?: Partial<Line>[] } | null;

export function ReceiptCountForm({
  receiptId,
  version,
  existing,
  heldRelease = false,
  onSuccess,
}: {
  receiptId: string;
  version: number;
  existing: Existing;
  heldRelease?: boolean;
  onSuccess: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
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
  const [error, setError] = useState('');
  const [itemsError, setItemsError] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const key = useRef<string | null>(null);
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
    fetchAll<Item>('logistics', '/items?status=ACTIVE')
      .then(setItems)
      .catch((cause) =>
        setItemsError(cause instanceof Error ? cause.message : 'Không thể tải danh mục vật phẩm.')
      );
  }, []);
  function edit(index: number, field: keyof Line, value: string) {
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, [field]: value } : line))
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
      await api('logistics', `/donation-receipts/${encodeURIComponent(receiptId)}/counts`, {
        method: 'POST',
        idempotencyKey: key.current,
        body: {
          expected_version: version,
          lines: lines.map((line) => ({
            item_id: line.item_id.trim(),
            counted_quantity: line.counted_quantity,
            accepted_quantity: line.accepted_quantity,
            held_quantity: line.held_quantity,
            rejected_quantity: line.rejected_quantity,
            ...(line.condition_note.trim() ? { condition_note: line.condition_note.trim() } : {}),
            ...(line.expiry_date ? { expiry_date: line.expiry_date } : {}),
          })),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      key.current = null;
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa xác nhận được kết quả kiểm đếm.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack command-form" onSubmit={submit} noValidate>
      <h3>{heldRelease ? 'Kiểm tra lại hàng tạm giữ' : 'Gửi kết quả kiểm đếm'}</h3>
      <p>
        {heldRelease ? 'Giữ nguyên vật phẩm, số đã đếm và số từ chối. Chỉ tăng phần tiếp nhận và giảm tương ứng phần tạm giữ; người khác phải duyệt độc lập trước khi nhập bổ sung.' : 'Ghi số lượng thực tế cho từng vật phẩm. Có thể thêm vật phẩm ngoài bản khai; người khác sẽ duyệt độc lập.'}
      </p>
      {itemsError && (
        <p className="notice error" role="alert">
          Danh mục vật phẩm: {itemsError} Bạn vẫn có thể nhập mã vật phẩm.
        </p>
      )}
      {lines.map((line, index) => (
        <fieldset className="candidate count-line" key={index}>
          <legend>Vật phẩm {index + 1}</legend>
          <label>
            Chọn vật phẩm
            <select
              disabled={heldRelease}
              value={items.some((item) => item.id === line.item_id) ? line.item_id : ''}
              onChange={(event) => edit(index, 'item_id', event.target.value)}
            >
              <option value="">Nhập mã bên dưới hoặc chọn danh mục</option>
              {items.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name} · {item.unit.display_name}
                </option>
              ))}
            </select>
          </label>
          <label>
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
          </label>
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
      {!heldRelease && lines.length < 50 && (
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
      <label>
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
      </label>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy ? 'Đang gửi kết quả…' : 'Gửi kiểm đếm để duyệt'}
      </button>
    </form>
  );
}
