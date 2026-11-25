import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { Dropdown } from '../../components/ui/Dropdown';
import { formatQuantity, quantityFitsScale } from '../../i18n/quantity';

type Row = Record<string, unknown> & { id?: string };
type Option = { value: string; label: string };
type Purpose = 'REQUEST_AID' | 'CAMPAIGN_DISTRIBUTION';
type Line = { key: string; ref: string; quantity: string };

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const MAX_LINES = 50;
let lineSeq = 0;
const newLine = (ref = '', quantity = ''): Line => ({ key: `line-${++lineSeq}`, ref, quantity });

/**
 * Creates one distribution slip with several item lines (the API accepts up to 50).
 * SOS aid lines each draw on a stock commitment; campaign lines draw on available stock.
 */
export function DistributionCreateForm({ warehouses, campaigns, items, itemScales, itemUnits, commitments, commitmentsLoading, onCreated }: {
  warehouses: Option[]; campaigns: Option[]; items: Option[]; itemScales: Option[]; itemUnits: Option[];
  commitments: Row[]; commitmentsLoading: boolean;
  onCreated: (record: Row) => void;
}) {
  const [purpose, setPurpose] = useState<Purpose | ''>('');
  const [warehouseId, setWarehouseId] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [stock, setStock] = useState<Map<string, Row> | null>(null);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const commandKey = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    void fetchAll<Row>('logistics', '/stock')
      .then((rows) => { if (live) setStock(new Map(rows.map((row) => [`${text(row.warehouse_id)}:${text(row.item_id)}`, row]))); })
      .catch(() => { if (live) setStock(null); });
    return () => { live = false; };
  }, []);
  // Any edit makes this a new command; a retry of the same unchanged form reuses its key.
  useEffect(() => { commandKey.current = null; setError(''); }, [purpose, warehouseId, campaignId, lines]);

  const warehouseCommitments = useMemo(
    () => commitments.filter((item) => item.id && item.warehouse_id === warehouseId && Number(item.reserved_remaining) > 0),
    [commitments, warehouseId]);
  const stockItems = useMemo(() => {
    if (!warehouseId) return [];
    if (!stock) return items; // Stock could not be read: let the backend decide.
    return items.filter((item) => Number(stock.get(`${warehouseId}:${item.value}`)?.available ?? 0) > 0);
  }, [items, stock, warehouseId]);

  const scaleOf = (itemId: string, commitment?: Row) => commitment?.unit_scale != null
    ? Number(commitment.unit_scale) : Number(itemScales.find((item) => item.value === itemId)?.label ?? 0);
  function describe(line: Line) {
    if (purpose === 'REQUEST_AID') {
      const commitment = warehouseCommitments.find((item) => item.id === line.ref);
      return commitment ? {
        itemId: text(commitment.item_id), max: Number(commitment.reserved_remaining), maxText: text(commitment.reserved_remaining),
        unit: text(commitment.unit_name), scale: scaleOf(text(commitment.item_id), commitment),
      } : null;
    }
    if (!line.ref) return null;
    const row = stock?.get(`${warehouseId}:${line.ref}`);
    return {
      itemId: line.ref, max: row ? Number(row.available) : undefined, maxText: row ? text(row.available) : '',
      unit: text(row?.unit) || itemUnits.find((unit) => unit.value === line.ref)?.label || '', scale: scaleOf(line.ref),
    };
  }
  function lineError(line: Line): string {
    if (!line.ref) return purpose === 'REQUEST_AID' ? 'Chọn cam kết.' : 'Chọn vật phẩm.';
    const info = describe(line);
    const value = line.quantity.trim().replace(',', '.');
    if (!value) return 'Nhập số lượng.';
    if (!info) return '';
    if (!quantityFitsScale(value, info.scale)) return info.scale === 0 ? 'Số lượng phải là số nguyên.' : `Tối đa ${info.scale} chữ số thập phân.`;
    if (Number(value) <= 0) return 'Số lượng phải lớn hơn 0.';
    if (info.max !== undefined && Number(value) > info.max) return `Vượt quá ${formatQuantity(info.maxText)} ${info.unit} còn lại.`;
    return '';
  }
  const formError = !purpose ? 'Chọn phân phối cho SOS hay chiến dịch.'
    : !warehouseId ? 'Chọn kho xuất hàng.'
      : purpose === 'CAMPAIGN_DISTRIBUTION' && !campaignId ? 'Chọn chiến dịch.'
        : lines.some((line) => lineError(line)) ? 'Kiểm tra lại các dòng vật phẩm.' : '';

  function update(key: string, patch: Partial<Line>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line));
  }
  function chooseRef(key: string, ref: string) {
    // For SOS aid, prefill the whole remaining commitment; staff can lower it.
    const commitment = purpose === 'REQUEST_AID' ? warehouseCommitments.find((item) => item.id === ref) : undefined;
    update(key, { ref, ...(commitment ? { quantity: text(commitment.reserved_remaining) } : {}) });
  }
  function reset(nextPurpose: Purpose | '', nextWarehouse: string) {
    setPurpose(nextPurpose);
    setWarehouseId(nextWarehouse);
    setLines([newLine()]);
    setTouched(false);
  }
  function addAllCommitments() {
    const used = new Set(lines.map((line) => line.ref).filter(Boolean));
    const extra = warehouseCommitments.filter((item) => !used.has(item.id!)).map((item) => newLine(item.id!, text(item.reserved_remaining)));
    setLines((current) => [...current.filter((line) => line.ref), ...extra].slice(0, MAX_LINES));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (formError || busy || !purpose) return;
    setBusy(true);
    setError('');
    try {
      commandKey.current ||= newCommandKey();
      const record = await api<Row>('logistics', '/distributions', {
        method: 'POST', idempotencyKey: commandKey.current,
        body: {
          warehouse_id: warehouseId,
          purpose,
          ...(purpose === 'CAMPAIGN_DISTRIBUTION' ? { campaign_id: campaignId } : {}),
          lines: lines.map((line) => {
            const info = describe(line)!;
            return { item_id: info.itemId, quantity: line.quantity.trim().replace(',', '.'),
              ...(purpose === 'REQUEST_AID' ? { commitment_id: line.ref } : {}) };
          }),
        },
      });
      onCreated(record);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa tạo được phiếu phân phối.');
    } finally {
      setBusy(false);
    }
  }

  const refOptions = (line: Line): Option[] => {
    const usedElsewhere = new Set(lines.filter((other) => other.key !== line.key).map((other) => other.ref));
    return purpose === 'REQUEST_AID'
      ? warehouseCommitments.filter((item) => !usedElsewhere.has(item.id!)).map((item) => ({ value: item.id!,
        label: `${text(item.item_name)} · còn ${formatQuantity(item.reserved_remaining)} ${text(item.unit_name)} · SOS …${text(item.request_id).slice(-8)}` }))
      : stockItems.filter((item) => !usedElsewhere.has(item.value)).map((item) => {
        const row = stock?.get(`${warehouseId}:${item.value}`);
        return { value: item.value, label: row ? `${item.label} · còn ${formatQuantity(row.available)} ${text(row.unit)}` : item.label };
      });
  };
  const noSource = Boolean(warehouseId && purpose && (purpose === 'REQUEST_AID'
    ? !commitmentsLoading && warehouseCommitments.length === 0
    : stock && stockItems.length === 0));
  const validLines = lines.filter((line) => line.ref && !lineError(line)).length;

  return <form className="distribution-create" onSubmit={(event) => void submit(event)} noValidate>
    <fieldset className="command-choice-list">
      <legend>Phân phối cho <span className="required-mark" aria-hidden="true">*</span></legend>
      {([['REQUEST_AID', 'Một hoặc nhiều yêu cầu SOS · lấy từ cam kết xuất kho đã giữ hàng'],
        ['CAMPAIGN_DISTRIBUTION', 'Một chiến dịch · phát trực tiếp từ tồn kho']] as const).map(([value, title]) =>
        <button key={value} type="button" className={`command-choice-card ${purpose === value ? 'selected' : ''}`} aria-pressed={purpose === value}
          onClick={() => reset(value, warehouseId)}>
          <span>{title}</span><span className="command-choice-indicator" aria-hidden="true">{purpose === value ? '✓' : ''}</span>
        </button>)}
    </fieldset>

    {purpose && <div className="distribution-create__row">
      <label className="filter"><span>Kho xuất hàng <span className="required-mark" aria-hidden="true">*</span></span>
        <Dropdown value={warehouseId} required aria-label="Kho xuất hàng" onChange={(event) => reset(purpose, event.target.value)}>
          <option value="">Chọn kho xuất hàng</option>
          {warehouses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Dropdown>
      </label>
      {purpose === 'CAMPAIGN_DISTRIBUTION' && <label className="filter"><span>Chiến dịch <span className="required-mark" aria-hidden="true">*</span></span>
        <Dropdown value={campaignId} required aria-label="Chiến dịch" onChange={(event) => setCampaignId(event.target.value)}>
          <option value="">Chọn chiến dịch đang hoạt động</option>
          {campaigns.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Dropdown>
      </label>}
    </div>}

    {purpose && warehouseId && <section className="distribution-create__lines" aria-label="Vật phẩm trong phiếu">
      <div className="distribution-create__lines-head">
        <h3>Vật phẩm trong phiếu</h3>
        {purpose === 'REQUEST_AID' && warehouseCommitments.length > 1 &&
          <button type="button" className="button secondary small" onClick={addAllCommitments}>Thêm mọi cam kết của kho này</button>}
      </div>
      {purpose === 'REQUEST_AID' && commitmentsLoading && <p role="status" className="muted">Đang tải cam kết xuất kho…</p>}
      {noSource ? <p className="notice warning">{purpose === 'REQUEST_AID'
        ? 'Kho này chưa có cam kết xuất kho còn hàng. Hãy tạo cam kết cho nhu cầu SOS ở tab “Nhu cầu và quyên góp” trước.'
        : 'Kho này hiện không còn vật phẩm khả dụng. Hãy chọn kho khác hoặc nhập kho trước khi lập phiếu.'}</p>
        : <>
          <ol className="distribution-create__list">
            {lines.map((line, index) => {
              const info = describe(line);
              const problem = touched || line.quantity ? lineError(line) : '';
              return <li key={line.key} className="distribution-create__line">
                <span className="distribution-create__index" aria-hidden="true">{index + 1}</span>
                <label className="distribution-create__ref">
                  <span className="visually-hidden">{purpose === 'REQUEST_AID' ? `Cam kết dòng ${index + 1}` : `Vật phẩm dòng ${index + 1}`}</span>
                  <Dropdown value={line.ref} aria-label={purpose === 'REQUEST_AID' ? `Cam kết dòng ${index + 1}` : `Vật phẩm dòng ${index + 1}`}
                    onChange={(event) => chooseRef(line.key, event.target.value)}>
                    <option value="">{purpose === 'REQUEST_AID' ? 'Chọn cam kết SOS' : 'Chọn vật phẩm'}</option>
                    {refOptions(line).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </Dropdown>
                </label>
                <div className="distribution-create__qty">
                  <input inputMode="decimal" value={line.quantity} placeholder="Số lượng" aria-label={`Số lượng dòng ${index + 1}`} aria-invalid={Boolean(problem)}
                    onChange={(event) => update(line.key, { quantity: event.target.value })} />
                  <span className="distribution-create__unit">{info?.unit || ''}</span>
                </div>
                <button type="button" className="distribution-create__remove" aria-label={`Bỏ dòng ${index + 1}`} title="Bỏ dòng"
                  disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((other) => other.key !== line.key))}>×</button>
                {problem && <small className="field-error distribution-create__error">{problem}</small>}
              </li>;
            })}
          </ol>
          {lines.length < MAX_LINES && refOptions({ key: '', ref: '', quantity: '' }).length > lines.filter((line) => !line.ref).length &&
            <button type="button" className="button secondary distribution-create__add" onClick={() => setLines((current) => [...current, newLine()])}>+ Thêm vật phẩm</button>}
        </>}
    </section>}

    {touched && formError && <p className="notice error" role="alert">{formError}</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    <button type="submit" className="button" disabled={busy || noSource || !purpose}>
      {busy ? 'Đang tạo phiếu…' : validLines > 1 ? `Tạo phiếu phân phối (${validLines} vật phẩm)` : 'Tạo phiếu phân phối'}
    </button>
  </form>;
}
