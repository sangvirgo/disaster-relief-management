import { useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey } from '../../api/client';
import { Dropdown } from '../../components/ui/Dropdown';

type Option = { value: string; label: string };
type StockLine = { id: number; itemId: string; quantity: string };

export function OpeningStockForm({ warehouse, items, itemScales, itemUnits, onSuccess }: {
  warehouse: { id: string; name: string };
  items: Option[]; itemScales: Option[]; itemUnits: Option[]; onSuccess: () => void;
}) {
  const [lines, setLines] = useState<StockLine[]>([{ id: 0, itemId: '', quantity: '' }]);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nextId = useRef(1);
  const pending = useRef<{ key: string; body: Record<string, unknown> } | null>(null);
  const limit = Math.min(50, items.length);

  function updateLine(id: number, patch: Partial<StockLine>) {
    setLines(current => current.map(line => line.id === id ? { ...line, ...patch } : line));
    setError('');
    pending.current = null;
  }

  const lineErrors = lines.map(line => {
    const scale = Number(itemScales.find(item => item.value === line.itemId)?.label);
    const duplicate = Boolean(line.itemId && lines.some(other => other.id !== line.id && other.itemId === line.itemId));
    const validQuantity = /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(line.quantity)
      && Number.isFinite(Number(line.quantity)) && Number(line.quantity) > 0
      && line.quantity.split('.')[0]!.replace(/^0+/, '').length <= 15
      && Number.isInteger(scale) && (line.quantity.split('.')[1]?.length ?? 0) <= scale;
    return {
      item: !line.itemId ? 'Hãy chọn vật phẩm.' : duplicate ? 'Vật phẩm đã có trong bảng.' : '',
      quantity: !line.quantity ? 'Hãy nhập số tồn.' : validQuantity ? '' : `Số tồn phải lớn hơn 0 và có tối đa ${Number.isInteger(scale) ? scale : 0} chữ số thập phân.`,
    };
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (!lines.length || lineErrors.some(line => line.item || line.quantity)) {
      setError('Hãy chọn vật phẩm và nhập số tồn hợp lệ cho từng dòng.');
      return;
    }
    if (!pending.current) pending.current = {
      key: newCommandKey(),
      body: {
        warehouse_id: warehouse.id,
        lines: lines.map(line => ({ item_id: line.itemId, quantity: line.quantity })),
        note: `Khai báo tồn đầu kỳ tại ${warehouse.name}`.slice(0, 1000),
      },
    };
    setBusy(true);
    setError('');
    try {
      await api('logistics', '/stock/opening', { method: 'POST', body: pending.current.body, idempotencyKey: pending.current.key });
      pending.current = null;
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa khai báo được tồn đầu kỳ.');
    } finally { setBusy(false); }
  }

  return <form className="opening-stock-form" onSubmit={event => void submit(event)} noValidate>
    <div className="opening-stock-table-wrap" role="region" aria-label="Bảng khai báo tồn đầu kỳ" tabIndex={0}>
      <table className="opening-stock-table">
        <thead><tr><th scope="col">Vật phẩm</th><th scope="col">Tồn đầu kỳ</th><th scope="col" aria-label="Thao tác" /></tr></thead>
        <tbody>{lines.map((line, index) => {
          const unit = itemUnits.find(item => item.value === line.itemId)?.label;
          const scale = Number(itemScales.find(item => item.value === line.itemId)?.label ?? 0);
          return <tr key={line.id}>
            <td><Dropdown aria-label={`Vật phẩm dòng ${index + 1}`} required disabled={busy} value={line.itemId}
              aria-invalid={Boolean(attempted && lineErrors[index].item)}
              onChange={event => updateLine(line.id, { itemId: event.target.value, quantity: '' })}>
              <option value="">Chọn vật phẩm</option>
              {items.filter(item => item.value === line.itemId || !lines.some(other => other.itemId === item.value)).map(item =>
                <option key={item.value} value={item.value}>{item.label}</option>)}
            </Dropdown>{attempted && lineErrors[index].item && <small className="field-error" role="alert">{lineErrors[index].item}</small>}</td>
            <td><div className="opening-stock-quantity"><input aria-label={`Tồn đầu kỳ dòng ${index + 1}`} type="number" inputMode="decimal" min="0" step={10 ** -scale}
              placeholder="Nhập số tồn" value={line.quantity} disabled={busy} aria-invalid={Boolean(attempted && lineErrors[index].quantity)}
              onChange={event => updateLine(line.id, { quantity: event.target.value })} />
              {unit && <span>{unit}</span>}</div>
              {attempted && lineErrors[index].quantity && <small className="field-error" role="alert">{lineErrors[index].quantity}</small>}</td>
            <td>{lines.length > 1 && <button type="button" className="opening-stock-remove" aria-label={`Xóa vật phẩm dòng ${index + 1}`} title="Xóa dòng" disabled={busy}
              onClick={() => { setLines(current => current.filter(other => other.id !== line.id)); setError(''); pending.current = null; }}>×</button>}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <button type="button" className="button secondary opening-stock-add" disabled={busy || lines.length >= limit}
      onClick={() => { setLines(current => [...current, { id: nextId.current++, itemId: '', quantity: '' }]); setError(''); pending.current = null; }}>+ Thêm vật phẩm</button>
    {error && <p className="notice error" role="alert">{error}</p>}
    <div className="form-actions"><button type="submit" className="button" disabled={busy || !items.length}>
      {busy ? 'Đang khai báo…' : 'Khai báo tồn đầu kỳ'}
    </button></div>
  </form>;
}
