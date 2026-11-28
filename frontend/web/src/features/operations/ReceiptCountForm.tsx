import { itemUnitName } from '../../i18n/units';
import { Dropdown } from '../../components/ui/Dropdown';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey, upload } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { loadStaffDrive } from '../../api/staffDrive';
import { useUnsavedWork } from '../../app/useUnsavedWork';
import { clearCountDraft, readCountDraft, writeCountDraft, type CountLine as Line } from './countDraft';
import { evidenceFileError } from '../../i18n/evidence';
import './receipt-count.css';

type Item = { id: string; name: string; unit: { display_name: string; scale: number } };
type Drive = { id: string; items: { item_id: string; item_name: string; unit_name: string; scale: number }[] };
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
  userId,
  receiptId,
  deliveryId,
  create,
  driveId,
  version,
  existing,
  initialItems,
  heldRelease = false,
  confirm,
  onSuccess,
}: {
  userId: string;
  receiptId: string;
  deliveryId: string;
  /** When there is no receipt yet, it is created from this delivery and warehouse right before the first count is sent. */
  create?: { deliveryId: string; warehouseId: string };
  driveId: string;
  driveTitle: string;
  version: number;
  existing: Existing;
  /** Item identities from the first count, without exposing its quantities to the independent counter. */
  initialItems?: Item[];
  heldRelease?: boolean;
  /** Independent second count: the figures are compared with the recorded count and a match approves the receipt. */
  confirm?: { countRevision: number; declarationRevision: number };
  onSuccess: (result?: { confirmation?: { matched: boolean; posted?: boolean; mismatched_items: string[] } }) => void;
}) {
  const draftScope = { userId, deliveryId, version, mode: confirm ? 'confirm' : heldRelease ? 'release' : 'count', countRevision: confirm?.countRevision, declarationRevision: confirm?.declarationRevision };
  const [restored, setRestored] = useState(() => readCountDraft(draftScope));
  const [driveItems, setDriveItems] = useState<Item[]>([]);
  const [catalogItems, setCatalogItems] = useState<Item[]>([]);
  const [allowUnexpected, setAllowUnexpected] = useState(restored?.allowUnexpected || false);
  const [driveLoading, setDriveLoading] = useState(true);
  const [driveRevision, setDriveRevision] = useState(0);
  const initializedItems = useRef(Boolean(restored));
  const [lines, setLines] = useState<Line[]>(
    restored?.lines || (existing?.lines?.length
      ? existing.lines.map((line) => ({
          item_id: line.item_id || '',
          counted_quantity: normalizeQuantity(line.counted_quantity) || '',
          accepted_quantity: normalizeQuantity(line.accepted_quantity) || '',
          held_quantity: normalizeQuantity(line.held_quantity) || '0',
          rejected_quantity: normalizeQuantity(line.rejected_quantity) || '0',
          condition_note: line.condition_note || '',
          expiry_date: line.expiry_date || '',
        }))
      : [empty()])
  );
  const [note, setNote] = useState(restored?.note || '');
  const [dirty, setDirty] = useState(Boolean(restored));
  const [draftSaved, setDraftSaved] = useState(Boolean(restored));
  const [advanced, setAdvanced] = useState(restored?.advanced || Boolean(existing?.lines?.some(line => Number(line.held_quantity) > 0 || Number(line.rejected_quantity) > 0 || line.condition_note || line.expiry_date)));
  const [error, setError] = useState('');
  const [itemsError, setItemsError] = useState('');
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<File | null>(null);
  useUnsavedWork((dirty && !draftSaved) || Boolean(evidence) || busy, busy
    ? 'Kết quả đang được gửi, chưa xác nhận hoàn tất. Bạn vẫn muốn rời đi?'
    : evidence ? 'Tệp minh chứng chưa được gửi. Nếu rời đi, bạn cần chọn lại tệp. Bạn vẫn muốn rời đi?'
    : 'Không lưu được bản nháp trên trình duyệt. Rời biểu mẫu sẽ mất số liệu chưa gửi. Bạn vẫn muốn rời đi?');
  const [touched, setTouched] = useState<Record<string, boolean>>(restored?.touched || {});
  const [attempted, setAttempted] = useState(false);
  const key = useRef<string | null>(null);
  const createKey = useRef<string | null>(null);
  const evidenceKey = useRef<string | null>(null);
  const createdReceipt = useRef<{ id: string; version: number } | null>(null);
  useEffect(() => {
    if (!dirty) return;
    const save = () => setDraftSaved(writeCountDraft(draftScope, { lines, note, advanced, allowUnexpected, touched, evidenceName: evidence?.name || restored?.evidenceName || '' }));
    save();
    const timer = window.setInterval(save, 60_000);
    return () => window.clearInterval(timer);
  }, [dirty, lines, note, advanced, allowUnexpected, touched, evidence, userId, deliveryId, version, confirm?.countRevision, confirm?.declarationRevision]);
  const existingItems: Item[] = [...(initialItems || []), ...(existing?.lines || []).filter(line => line.item_id).map(line => ({
    id: line.item_id!, name: line.item_name || line.item_id!,
    unit: { display_name: itemUnitName(line.item_id, line.unit_name), scale: Number(line.unit_scale ?? 0) },
  }))];
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
    setItemsError('');
    Promise.all([
      loadStaffDrive<Drive>(driveId),
      create && !confirm ? api<{ declaration?: { lines?: { item_id: string }[] } }>('logistics', `/public/donations/${encodeURIComponent(deliveryId)}`, { credentials: 'omit' }) : Promise.resolve(null),
    ]).then(([drive, declaration]) => { if (!live) return;
        if (!initializedItems.current && !existing?.lines?.length && !heldRelease) {
          const itemIds = initialItems?.length ? initialItems.map(item => ({ item_id: item.id })) : declaration?.declaration?.lines || drive.items;
          setLines(itemIds.map(item => ({ ...empty(), item_id: item.item_id })));
          initializedItems.current = true;
        }
        setDriveItems(drive.items.map(item => ({
        id: item.item_id, name: item.item_name,
        unit: { display_name: itemUnitName(item.item_id, item.unit_name), scale: Number(item.scale) },
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
    setDirty(true);
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
    if (hasInvalidFields || (evidence && evidenceFileError(evidence))) return;
    setError('');
    setBusy(true);
    try {
      key.current ||= newCommandKey();
      if (create && !receiptId && !createdReceipt.current) {
        createKey.current ||= newCommandKey();
        const created = await api<{ id: string; version: number }>('logistics', '/donation-receipts', {
          method: 'POST', idempotencyKey: createKey.current,
          body: { delivery_id: create.deliveryId, warehouse_id: create.warehouseId },
        });
        createdReceipt.current = { id: created.id, version: Number(created.version) };
      }
      const targetReceipt = createdReceipt.current?.id || receiptId;
      const targetVersion = createdReceipt.current?.version ?? version;
      if (evidence) {
        evidenceKey.current ||= newCommandKey();
        await upload('logistics', `/public/donations/${encodeURIComponent(deliveryId)}/evidence`, evidence, {
          idempotencyKey: evidenceKey.current,
        });
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
      clearCountDraft(draftScope);
      setDirty(false);
      onSuccess(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa xác nhận được kết quả kiểm đếm.');
    } finally {
      setBusy(false);
    }
  }
  function discardDraft() {
    if (!window.confirm('Bỏ bản nháp kiểm đếm này và nhập lại?')) return;
    clearCountDraft(draftScope);
    setRestored(null);
    setDirty(false);
    setDraftSaved(false);
    setNote(''); setTouched({}); setEvidence(null); setAllowUnexpected(false);
    setAdvanced(heldRelease);
    setLines(existing?.lines?.length ? existing.lines.map(line => ({
      item_id: line.item_id || '', counted_quantity: normalizeQuantity(line.counted_quantity) || '',
      accepted_quantity: normalizeQuantity(line.accepted_quantity) || '', held_quantity: normalizeQuantity(line.held_quantity) || '0',
      rejected_quantity: normalizeQuantity(line.rejected_quantity) || '0', condition_note: line.condition_note || '', expiry_date: line.expiry_date || '',
    })) : [empty()]);
    initializedItems.current = false;
    setDriveRevision(value => value + 1);
    key.current = null;
  }
  const columns = (advanced || heldRelease ? [
    ['counted_quantity', 'Đã đếm'],
    ['accepted_quantity', 'Tiếp nhận'],
    ['held_quantity', 'Tạm giữ'],
    ['rejected_quantity', 'Từ chối'],
  ] : [['counted_quantity', 'Số đếm được']]) as readonly (readonly [keyof Line & `${string}_quantity`, string])[];
  const canAddLine = !heldRelease && lines.length < (allowUnexpected ? items.length : driveItems.length);
  const fixedItem = (line: Line) => heldRelease || (Boolean(confirm) && !line.outside && Boolean(line.item_id));
  const gridTemplateColumns = columns.length === 1
    ? 'minmax(180px, 1fr) minmax(180px, 1fr) 36px'
    : `minmax(180px, 2fr) repeat(${columns.length}, minmax(96px, 1fr)) 36px`;
  return (
    <form className="count-form" onSubmit={submit} noValidate>
      {restored && <div className="notice" role="status"><p>Đã khôi phục số liệu bạn đang nhập. Đây là bản nháp chưa gửi.{restored.evidenceName ? ' Tệp minh chứng cần chọn lại nếu muốn đính kèm.' : ''}</p><button type="button" className="button secondary" disabled={busy} onClick={discardDraft}>Bỏ bản nháp</button></div>}
      {!restored && dirty && draftSaved && <small className="muted" role="status">Đã lưu bản nháp trong phiên trình duyệt này, giữ 30 phút sau khi rời biểu mẫu. Kết quả chưa được gửi.</small>}
      <header className="count-form__intro">
        <h3>{heldRelease ? 'Kiểm tra lại hàng tạm giữ' : confirm ? 'Xác nhận kiểm đếm độc lập' : 'Nhập kết quả kiểm đếm'}</h3>
        <p>{confirm
          ? 'Tự đếm hàng thực tế rồi nhập số đếm được. Số của lần đếm trước được ẩn để bạn đếm độc lập. Nếu khớp, biên nhận được duyệt và ghi vào tồn kho ngay.'
          : heldRelease ? 'Chỉ tăng phần tiếp nhận và giảm tương ứng phần tạm giữ.' : 'Nhập số lượng đếm được cho từng vật phẩm.'}</p>
      </header>
      {driveLoading && <p role="status" className="muted">Đang tải vật phẩm của đợt quyên góp…</p>}
      {itemsError && <p className="notice error" role="alert">{itemsError}</p>}
      {!driveLoading && !driveItems.length && <button className="button secondary" type="button" onClick={() => { setItemsError(''); setDriveRevision(current => current + 1); }}>Tải lại vật phẩm của đợt</button>}

      <fieldset className="count-form__fields" disabled={busy || driveLoading} aria-label="Kết quả kiểm đếm">
      {!heldRelease && <div className="count-form__options" role="group" aria-label="Tùy chọn kiểm đếm">
        <label className="count-form__toggle">
          <input type="checkbox" checked={advanced} onChange={() => setAdvanced((value) => !value)} />
          <span>Có hàng lỗi, tạm giữ hoặc cần ghi chú</span>
        </label>
        <label className="count-form__toggle">
          <input type="checkbox" checked={allowUnexpected} disabled={allowUnexpected} onChange={() => {
            setDirty(true);
            setAllowUnexpected(true);
            setAdvanced(true);
            setLines(current => [...current, { ...empty(), outside: true }]);
            setItemsError('');
            key.current = null;
          }} />
          <span>Có vật phẩm ngoài danh sách của đợt</span>
        </label>
      </div>}
      {allowUnexpected && !heldRelease && <p className="notice warning">Dòng ngoài đợt được đánh dấu để người duyệt rà soát. Chỉ dùng khi hàng thực tế khác danh sách của đợt.</p>}

      <div className="count-form__table" role="table" aria-label="Số lượng kiểm đếm">
        <div className="count-form__row count-form__row--head" role="row" style={{ gridTemplateColumns }}>
          <span role="columnheader">Vật phẩm</span>
          {columns.map(([field, title]) => <span role="columnheader" key={field} className="numeric">{title}</span>)}
          <span aria-hidden="true" />
        </div>
        {lines.map((line, index) => {
          const item = items.find((candidate) => candidate.id === line.item_id);
          const rowErrors = [`${index}.item_id`, ...columns.map(([field]) => `${index}.${field}`)]
            .filter((field) => fieldErrors[field] && showFieldError(field, field.endsWith('item_id') ? line.item_id : line[field.split('.')[1] as keyof Line] as string))
            .map((field) => fieldErrors[field]);
          return <div key={index} className={`count-form__line${line.outside ? ' count-form__line--outside' : ''}`}>
            <div className="count-form__row" role="row" style={{ gridTemplateColumns }}>
              <span role="cell" className="count-form__item">
                {fixedItem(line) ? <><strong>{item?.name || 'Vật phẩm'}</strong><small>{itemUnitName(item?.id, item?.unit.display_name)}</small></>
                  : <Dropdown
                    aria-label={`Vật phẩm dòng ${index + 1}`}
                    value={items.some((candidate) => candidate.id === line.item_id) ? line.item_id : ''}
                    onChange={(event) => edit(index, 'item_id', event.target.value)}
                  >
                    <option value="">{line.outside ? 'Chọn vật phẩm ngoài đợt' : 'Chọn vật phẩm'}</option>
                    {items.filter(candidate => (candidate.id === line.item_id || !lines.some(other => other.item_id === candidate.id)) && (!line.outside || !driveItems.some(driveItem => driveItem.id === candidate.id))).map((candidate) => (
                      <option value={candidate.id} key={candidate.id}>
                        {candidate.name} · {itemUnitName(candidate.id, candidate.unit.display_name)}{!driveItems.some(driveItem => driveItem.id === candidate.id) ? ' · ngoài đợt' : ''}
                      </option>
                    ))}
                  </Dropdown>}
                {line.outside && <em className="count-form__flag">Ngoài đợt</em>}
              </span>
              {columns.map(([field, title]) => <span role="cell" key={field} className="count-form__qty">
                <input
                  inputMode="decimal"
                  aria-label={`${title} · ${item?.name || `dòng ${index + 1}`}`}
                  readOnly={heldRelease && ['counted_quantity', 'rejected_quantity'].includes(field)}
                  aria-invalid={Boolean(showFieldError(`${index}.${field}`, line[field]) && fieldErrors[`${index}.${field}`])}
                  value={line[field]}
                  placeholder="0"
                  onChange={(event) => edit(index, field, event.target.value.replace(',', '.'))}
                  onBlur={() => setTouched((current) => ({ ...current, [`${index}.${field}`]: true }))}
                />
              </span>)}
              <span role="cell">
                {!heldRelease && lines.length > 1 && <button className="count-form__remove" type="button" aria-label={`Bỏ dòng ${index + 1}`} title="Bỏ dòng"
                  onClick={() => { setDirty(true); setLines(lines.filter((_, position) => position !== index)); key.current = null; }}>×</button>}
              </span>
            </div>
            {(advanced || heldRelease) && <div className="count-form__extra">
              <input
                maxLength={1001}
                aria-label={`Ghi chú tình trạng · ${item?.name || `dòng ${index + 1}`}`}
                placeholder="Ghi chú tình trạng (nếu có)"
                aria-invalid={Boolean(showFieldError(`${index}.condition_note`, line.condition_note) && fieldErrors[`${index}.condition_note`])}
                value={line.condition_note}
                onChange={(event) => edit(index, 'condition_note', event.target.value)}
              />
              <span className="count-form__date">
                <small>Hạn sử dụng</small>
                <input type="date" aria-label={`Hạn sử dụng · ${item?.name || `dòng ${index + 1}`}`} value={line.expiry_date} onChange={(event) => edit(index, 'expiry_date', event.target.value)} />
              </span>
            </div>}
            {rowErrors.length > 0 && <small className="field-error count-form__error" role="alert">{[...new Set(rowErrors)].join(' ')}</small>}
          </div>;
        })}
      </div>
      {canAddLine && <button className="button secondary count-form__add" type="button" onClick={() => {
        setDirty(true);
        const nextItem = allowUnexpected ? undefined : driveItems.find(item => !lines.some(line => line.item_id === item.id));
        setLines([...lines, { ...empty(), item_id: nextItem?.id || '', outside: allowUnexpected }]);
        key.current = null;
      }}>+ Thêm vật phẩm</button>}

      {(advanced || heldRelease) && <label className="count-form__note">
        <span>Ghi chú chung</span>
        <textarea
          maxLength={1001}
          rows={2}
          aria-invalid={Boolean(showFieldError('note', note) && fieldErrors.note)}
          value={note}
          onChange={(event) => { setDirty(true); setNote(event.target.value); setTouched((current) => ({ ...current, note: true })); key.current = null; }}
          onBlur={() => setTouched((current) => ({ ...current, note: true }))}
        />
        {showFieldError('note', note) && fieldErrors.note && <small className="field-error" role="alert">{fieldErrors.note}</small>}
      </label>}
      {!heldRelease && <div className="count-form__evidence">
        <span>Ảnh hoặc video minh chứng <small>(không bắt buộc)</small></span>
        <label className="count-form__file">
          <input type="file" accept="image/jpeg,image/png,video/mp4" onChange={event => { setDirty(true); setEvidence(event.target.files?.[0] || null); key.current = null; evidenceKey.current = null; }} />
          <span className="button secondary">Chọn tệp</span>
          <span className="count-form__file-name">{evidence ? evidence.name : 'Chưa chọn tệp (JPG, PNG hoặc MP4)'}</span>
        </label>
        {evidence && evidenceFileError(evidence) && <small className="field-error" role="alert">{evidenceFileError(evidence)}</small>}
      </div>}
      {error && <p className="notice error" role="alert">{error}</p>}
      <button className="button count-form__submit" disabled={busy || driveLoading || !driveItems.length || hasInvalidFields || Boolean(evidence && evidenceFileError(evidence))}>
        {busy ? 'Đang gửi…' : confirm ? 'Gửi xác nhận kiểm đếm' : 'Gửi kết quả đếm'}
      </button>
      </fieldset>
    </form>
  );
}
