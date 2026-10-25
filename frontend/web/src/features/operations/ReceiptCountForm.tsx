import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey } from '../../api/client';

type Item = { id: string; name: string; unit_name: string; scale: number };
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
  held_quantity: '',
  rejected_quantity: '',
  condition_note: '',
  expiry_date: '',
});
type Existing = { lines?: Partial<Line>[] } | null;

export function ReceiptCountForm({
  receiptId,
  version,
  existing,
  onSuccess,
}: {
  receiptId: string;
  version: number;
  existing: Existing;
  onSuccess: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [lines, setLines] = useState<Line[]>(
    existing?.lines?.length
      ? existing.lines.map((line) => ({
          item_id: line.item_id || '',
          counted_quantity: line.counted_quantity || '',
          accepted_quantity: line.accepted_quantity || '',
          held_quantity: line.held_quantity || '',
          rejected_quantity: line.rejected_quantity || '',
          condition_note: line.condition_note || '',
          expiry_date: line.expiry_date || '',
        }))
      : [empty()]
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [itemsError, setItemsError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);
  useEffect(() => {
    api<{ items: Item[] }>('logistics', '/items?status=ACTIVE&limit=100')
      .then((result) => setItems(result.items))
      .catch((cause) => setItemsError(cause instanceof Error ? cause.message : 'Không thể tải danh mục vật phẩm.'));
  }, []);
  function edit(index: number, field: keyof Line, value: string) {
    setLines((current) =>
      current.map((line, position) => (position === index ? { ...line, [field]: value } : line))
    );
    key.current = null;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    for (const [index, line] of lines.entries()) {
      if (!line.item_id.trim()) {
        setError(`Vật phẩm ${index + 1}: vui lòng chọn hoặc nhập mã vật phẩm.`);
        return;
      }
      for (const [field, title] of [
        ['counted_quantity', 'Số đã đếm'],
        ['accepted_quantity', 'Số tiếp nhận'],
        ['held_quantity', 'Số tạm giữ'],
        ['rejected_quantity', 'Số từ chối'],
      ] as const) {
        const quantity = line[field].trim();
        if (!quantity || !/^\d+(?:\.\d+)?$/.test(quantity)) {
          setError(`Vật phẩm ${index + 1}: ${title.toLowerCase()} phải là số không âm.`);
          return;
        }
        const item = items.find((candidate) => candidate.id === line.item_id);
        if (item && (quantity.split('.')[1]?.length || 0) > item.scale) {
          setError(`Vật phẩm ${index + 1}: ${title.toLowerCase()} chỉ được có tối đa ${item.scale} chữ số thập phân.`);
          return;
        }
      }
    }
    if (new Set(lines.map((line) => line.item_id)).size !== lines.length) {
      setError('Mỗi vật phẩm chỉ xuất hiện một lần trong lần kiểm đếm.');
      return;
    }
    if (
      lines.some(
        (line) =>
          Math.abs(
            Number(line.counted_quantity) -
              Number(line.accepted_quantity) -
              Number(line.held_quantity) -
              Number(line.rejected_quantity)
          ) > 1e-9
      )
    ) {
      setError('Với mỗi vật phẩm, số đã đếm phải bằng số tiếp nhận cộng số tạm giữ và số từ chối.');
      return;
    }
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
      <h3>Gửi kết quả kiểm đếm</h3>
      <p>
        Ghi số lượng thực tế cho từng vật phẩm. Có thể thêm vật phẩm ngoài bản khai; người khác sẽ
        duyệt độc lập.
      </p>
      {itemsError && <p className="notice error" role="alert">Danh mục vật phẩm: {itemsError} Bạn vẫn có thể nhập mã vật phẩm.</p>}
      {lines.map((line, index) => (
        <fieldset className="candidate count-line" key={index}>
          <legend>Vật phẩm {index + 1}</legend>
          <label>
            Chọn vật phẩm
            <select
              value={items.some((item) => item.id === line.item_id) ? line.item_id : ''}
              onChange={(event) => edit(index, 'item_id', event.target.value)}
            >
              <option value="">Nhập mã bên dưới hoặc chọn danh mục</option>
              {items.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name} · {item.unit_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mã vật phẩm
            <input
              required
              value={line.item_id}
              onChange={(event) => edit(index, 'item_id', event.target.value)}
              placeholder="Mã vật phẩm trong danh mục"
            />
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
                {title}
                <input
                  required
                  type="number"
                  min="0"
                  step="any"
                  value={line[field]}
                  onChange={(event) => edit(index, field, event.target.value)}
                />
              </label>
            ))}
          </div>
          <label>
            Ghi chú tình trạng
            <input
              value={line.condition_note}
              onChange={(event) => edit(index, 'condition_note', event.target.value)}
            />
          </label>
          <label>
            Hạn sử dụng nếu có
            <input
              type="date"
              value={line.expiry_date}
              onChange={(event) => edit(index, 'expiry_date', event.target.value)}
            />
          </label>
          {lines.length > 1 && (
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
      {lines.length < 50 && (
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
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            key.current = null;
          }}
        />
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
