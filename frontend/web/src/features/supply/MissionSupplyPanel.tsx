import { itemUnitName } from '../../i18n/units';
import { useEffect, useId, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { forgetCommandKey, sendRetryableCommand } from '../../api/retryableCommand';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { Skeleton } from '../../components/ui/Skeleton';
import { timeLabel } from '../../i18n/labels';
import { quantityInput } from '../../i18n/quantity';
import { prepareSupplyLines, validSupplyQuantity } from './supplyDraft';
import { readSupplyDraft, writeSupplyDraft, clearSupplyDraft } from './supplySessionDraft';
import { LIST_PAGE_SIZE, useCursorNav } from '../../api/useCursorNav';
import { ListNav } from '../../components/ui/Pager';
import {
  deadlineText, isUrgent, quantityText, suggestionBasisLabels, supplyStatusLabels, supplyStatusTones,
  type MissionSupply, type SuggestionBasis, type SupplySuggestion, type SupplyTeamRequest,
} from './supplyModel';
import './supply.css';

interface CatalogItem {
  id: string;
  name: string;
  unit_name: string;
  scale: number;
}

interface DraftLine {
  item_id: string;
  item_name: string;
  unit_name: string;
  quantity: string;
  basis?: SuggestionBasis;
}

const LIVE_MISSION = ['ACCEPTED', 'EN_ROUTE', 'ON_SCENE'];

/**
 * Relief goods for one mission, shown to the team (leader and members) and to the coordinator. The leader — or the
 * coordinator for a team without the app — asks for goods in one step: the list is pre-filled from the AI/norm
 * suggestion and stays editable. The system picks the warehouse and returns a pickup code to read out at the warehouse.
 */
export function MissionSupplyPanel({ missionId, missionStatus, userId, onBehalf = false }: {
  missionId: string;
  missionStatus: string;
  userId: string;
  /** True on the coordinator screen: requests are made on behalf of the team. */
  onBehalf?: boolean;
}) {
  const headingId = useId();
  const [data, setData] = useState<MissionSupply | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(false);
  const [revision, setRevision] = useState(0);
  const [composing, setComposing] = useState(() => LIVE_MISSION.includes(missionStatus) && readSupplyDraft(userId, missionId) !== null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyCursor, setHistoryCursor, previousHistory, historyPage] = useCursorNav<string>('');

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api<MissionSupply>('logistics', `/supply-requests?mission_id=${encodeURIComponent(missionId)}`)
      .then((value) => { if (live) { setData(value); setHidden(false); } })
      .catch((cause) => {
        if (!live) return;
        if (cause instanceof ApiError && (cause.code === 'FORBIDDEN' || cause.status === 403)) setHidden(true);
        else setError(cause instanceof Error ? cause.message : 'Không tải được thông tin hàng cứu trợ.');
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [missionId, revision]);

  const open = data?.items.find((item) => item.status === 'READY') ?? null;
  const history = (data?.items ?? []).filter((item) => item !== open);
  const historyOffset = Number(historyCursor || 0);
  const visibleHistory = history.slice(historyOffset, historyOffset + LIST_PAGE_SIZE);
  const canRequest = Boolean(data?.can_request) && LIVE_MISSION.includes(missionStatus);
  useEffect(() => {
    if (open || !LIVE_MISSION.includes(missionStatus)) clearSupplyDraft(userId, missionId);
  }, [open?.id, missionStatus, userId, missionId]);
  if (hidden) return null;

  return (
    <section className="card supply-panel" aria-labelledby={headingId}>
      <div className="supply-panel__head">
        <h3 id={headingId}>Hàng cứu trợ cho nhiệm vụ</h3>
        <Button variant="ghost" size="sm" disabled={loading} onClick={() => setRevision((value) => value + 1)}>Làm mới</Button>
      </div>
      {loading && !data && <Skeleton rows={2} label="Đang tải hàng cứu trợ…" />}
      {error && <p className="notice error" role="alert">{error}</p>}
      {data && open && <OpenRequest request={open} canCancel={canRequest} onChanged={() => setRevision((value) => value + 1)} />}
      {data && !open && !composing && (
        <div className="supply-panel__empty">
          <p className="muted">
            {canRequest
              ? 'Đội cần mang hàng đến hiện trường? Gửi yêu cầu, hệ thống sẽ tự chọn kho gần và giữ hàng cho đội.'
              : 'Chưa có yêu cầu hàng đang chờ cho nhiệm vụ này.'}
          </p>
          {canRequest && <Button onClick={() => setComposing(true)}>Yêu cầu hàng cứu trợ</Button>}
        </div>
      )}
      {data && !open && composing && canRequest && (
        <RequestForm key={`${userId}:${missionId}`} userId={userId} missionId={missionId} onBehalf={onBehalf} onCancel={() => { clearSupplyDraft(userId, missionId); setComposing(false); }}
          onCreated={() => { setComposing(false); setRevision((value) => value + 1); }} />
      )}
      {history.length > 0 && (
        <div className="supply-panel__history">
          <button type="button" className="button secondary supply-history-toggle" aria-expanded={showHistory} onClick={() => setShowHistory((value) => !value)}>
            {showHistory ? 'Ẩn yêu cầu trước' : `Xem ${history.length} yêu cầu trước`}
          </button>
          {showHistory && (
            <ul>
              {visibleHistory.map((item) => (
                <li key={item.id}>
                  <Badge tone={supplyStatusTones[item.status]}>{supplyStatusLabels[item.status]}</Badge>
                  <span>{item.warehouse.name} · {timeLabel(item.handed_over_at || item.cancelled_at || item.created_at)}</span>
                  <span className="muted">{item.lines.map((line) => `${line.item_name} ${quantityText(line.reserved_quantity, line.unit_name, line.item_id)}`).join(', ')}</span>
                  {item.cancel_reason && <span className="muted">Lý do: {item.cancel_reason}</span>}
                </li>
              ))}
            </ul>
          )}
          {showHistory && <ListNav page={historyPage} count={visibleHistory.length} hasNext={historyOffset + LIST_PAGE_SIZE < history.length}
            onPrev={previousHistory} onNext={() => setHistoryCursor(String(historyOffset + LIST_PAGE_SIZE))} noun="yêu cầu" />}
        </div>
      )}
    </section>
  );
}

function OpenRequest({ request, canCancel, onChanged }: { request: SupplyTeamRequest; canCancel: boolean; onChanged: () => void }) {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const urgent = isUrgent(request.expires_at);
  const mapUrl = request.warehouse.location
    ? `https://www.google.com/maps/dir/?api=1&destination=${request.warehouse.location.lat},${request.warehouse.location.lng}`
    : '';

  async function cancel(event: React.FormEvent) {
    event.preventDefault();
    if (!reason.trim()) { setError('Vui lòng ghi lý do hủy.'); return; }
    setBusy(true);
    setError('');
    try {
      await sendRetryableCommand(`supply-cancel:${request.id}`, 'logistics', `/supply-requests/${request.id}/cancel`, {
        expected_version: request.version, reason: reason.trim(),
      });
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không hủy được yêu cầu.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="supply-open">
      <div className="supply-code" aria-live="polite">
        <span>Mã nhận hàng</span>
        <strong aria-label={`Mã nhận hàng ${request.pickup_code?.split('').join(' ')}`}>{request.pickup_code}</strong>
        <small className={urgent ? 'supply-deadline supply-deadline--urgent' : 'supply-deadline'}>{deadlineText(request.expires_at)}</small>
      </div>
      <div className="supply-open__where">
        <div><span className="supply-open__eyebrow">Điểm nhận hàng</span><strong>{request.warehouse.name}</strong>
          {request.warehouse.address_note && <p>{request.warehouse.address_note}</p>}
        </div>
        {mapUrl && <a className="button supply-directions" href={mapUrl} target="_blank" rel="noopener noreferrer" aria-label="Chỉ đường đến kho, mở Google Maps trong thẻ mới"><span aria-hidden="true">↗</span> Chỉ đường đến kho</a>}
      </div>
      <p className="supply-open__hint">Đọc mã nhận hàng cho nhân viên kho khi đến lấy hàng.</p>
      <ul className="supply-card__items" aria-label="Hàng đã giữ cho đội">
        {request.lines.map((line) => (
          <li key={line.item_id}>
            <span>{line.item_name}</span>
            <strong>{quantityText(line.reserved_quantity, line.unit_name, line.item_id)}</strong>
            {Number(line.shortfall_quantity) > 0 && <small className="supply-shortfall">Thiếu {quantityText(line.shortfall_quantity, line.unit_name, line.item_id)}</small>}
          </li>
        ))}
      </ul>
      {request.has_shortfall && <p className="notice">Kho chưa đủ một số mặt hàng. Phần thiếu đã được ghi nhận để điều phối viên và kho bổ sung.</p>}
      {canCancel && !cancelling && <div className="supply-open__actions"><Button variant="ghost" size="sm" onClick={() => setCancelling(true)}>Hủy yêu cầu</Button></div>}
      {cancelling && (
        <form className="supply-inline-form" onSubmit={cancel}>
          <label>
            <span>Lý do hủy</span>
            <input value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="Ví dụ: đã nhận hàng từ nguồn khác" />
          </label>
          {error && <p className="notice error" role="alert">{error}</p>}
          <div className="supply-open__actions">
            <Button type="button" variant="secondary" size="sm" onClick={() => setCancelling(false)}>Quay lại</Button>
            <Button type="submit" variant="danger" size="sm" loading={busy}>Hủy yêu cầu</Button>
          </div>
        </form>
      )}
    </div>
  );
}

function RequestForm({ missionId, userId, onBehalf, onCancel, onCreated }: {
  missionId: string; userId: string; onBehalf: boolean; onCancel: () => void; onCreated: () => void;
}) {
  const addId = useId();
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suggestionNotice, setSuggestionNotice] = useState('');
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [lookupRevision, setLookupRevision] = useState(0);
  const [restored, setRestored] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setCatalogFailed(false);
    setSuggestionNotice('');
    setError('');
    Promise.allSettled([
      api<SupplySuggestion>('logistics', `/supply-requests/suggestion?mission_id=${encodeURIComponent(missionId)}`),
      fetchAll<{ id?: string; name?: string; status?: string; unit?: { display_name?: string; scale?: number } }>('logistics', '/items'),
    ]).then(([suggestion, items]) => {
      if (!live) return;
      if (suggestion.status === 'fulfilled') {
        if (!suggestion.value.lines.length) setSuggestionNotice('Chưa có gợi ý vật phẩm từ dữ liệu đã xử lý. Bạn có thể chọn hàng và số lượng theo nhu cầu thực tế của đội.');
        setLines(current => current.length ? current : suggestion.value.lines.map((line) => ({
          item_id: line.item_id, item_name: line.item_name, unit_name: itemUnitName(line.item_id, line.unit_name), quantity: quantityInput(line.quantity), basis: line.basis,
        })));
      }
      if (suggestion.status === 'rejected') setSuggestionNotice('Chưa tải được gợi ý vật phẩm. Bạn vẫn có thể chọn hàng từ danh mục nếu danh mục đã tải được.');
      if (items.status === 'fulfilled') {
        const catalogItems = items.value.filter((item) => item.id && item.status === 'ACTIVE').map((item) => ({
          id: item.id!, name: item.name || 'Mặt hàng', unit_name: itemUnitName(item.id, item.unit?.display_name), scale: Number(item.unit?.scale ?? 0),
        }));
        setCatalog(catalogItems);
        const draft = readSupplyDraft(userId, missionId);
        if (draft && lookupRevision === 0) {
          setLines(draft.map(line => {
            const item = catalogItems.find(item => item.id === line.item_id);
            return { ...line, item_name: item?.name ?? 'Vật phẩm không còn trong danh mục', unit_name: item?.unit_name ?? '' };
          }));
          setRestored(true);
        }
      }
      else setCatalogFailed(true);
      if (suggestion.status === 'rejected' && items.status === 'rejected') setError('Không tải được gợi ý và danh mục hàng. Hãy thử lại.');
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [missionId, userId, lookupRevision]);
  useEffect(() => {
    if (!loading && !catalogFailed) setSaved(writeSupplyDraft(userId, missionId, lines));
  }, [lines, loading, catalogFailed, userId, missionId]);

  const scaleOf = (itemId: string) => catalog.find((item) => item.id === itemId)?.scale ?? -1;
  const quantityError = (line: DraftLine) => scaleOf(line.item_id) < 0 ? 'Chưa tải được đơn vị vật phẩm. Hãy thử tải lại danh mục.'
    : validSupplyQuantity(line.quantity, scaleOf(line.item_id)) ? '' : `Nhập số lớn hơn 0, tối đa ${scaleOf(line.item_id)} chữ số thập phân.`;
  const available = catalog.filter((item) => !lines.some((line) => line.item_id === item.id));

  function update(index: number, quantity: string) {
    setLines((current) => current.map((line, at) => (at === index ? { ...line, quantity: quantity.replace(',', '.') } : line)));
    forgetCommandKey(`supply-create:${missionId}`);
  }

  function add(itemId: string) {
    const item = catalog.find((candidate) => candidate.id === itemId);
    if (!item) return;
    setLines((current) => [...current, { item_id: item.id, item_name: item.name, unit_name: item.unit_name, quantity: '1' }]);
    setAdding('');
    forgetCommandKey(`supply-create:${missionId}`);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const prepared = prepareSupplyLines(lines, scaleOf);
    const chosen = prepared.lines;
    if (!chosen) { setError(lines.length ? 'Kiểm tra các số lượng được đánh dấu bên dưới. Chưa có mặt hàng nào được gửi.' : 'Chọn ít nhất một mặt hàng với số lượng lớn hơn 0.'); return; }
    setBusy(true);
    setError('');
    try {
      await sendRetryableCommand(`supply-create:${missionId}`, 'logistics', '/supply-requests', {
        mission_id: missionId,
        lines: chosen.map((line) => ({ item_id: line.item_id, quantity: line.quantity })),
      });
      clearSupplyDraft(userId, missionId);
      onCreated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không gửi được yêu cầu hàng.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Skeleton rows={3} label="Đang chuẩn bị danh sách gợi ý…" />;
  return (
    <form className="supply-form" onSubmit={submit}>
      {saved && <p className="supply-open__hint" role="status">{restored ? 'Đã khôi phục bản nháp.' : 'Đã lưu bản nháp trong phiên này.'} Số lượng chưa được gửi tới kho.</p>}
      <p className="muted">
        {restored ? 'Kiểm tra lại số lượng trong bản nháp trước khi gửi.' : lines.some((line) => line.basis)
          ? 'Danh sách được gợi ý sẵn từ thông tin SOS. Hãy kiểm tra và sửa số lượng theo thực tế trước khi gửi.'
          : 'Chưa có gợi ý cho SOS này. Thêm các mặt hàng đội cần mang theo.'}
        {onBehalf && ' Bạn đang gửi yêu cầu thay cho đội.'}
      </p>
      {lines.length > 0 && (
        <ul className="supply-form__lines">
          {lines.map((line, index) => (
            <li key={line.item_id}>
              <div>
                <strong>{line.item_name}</strong>
                {line.basis && <small className="muted">{suggestionBasisLabels[line.basis]}</small>}
              </div>
              <label className="supply-form__qty" data-static-label>
                <span className="supply-form__qty-label">Số lượng</span>
                <div className="supply-form__qty-control">
                  <input aria-label={`Số lượng ${line.item_name}`} inputMode="decimal" value={line.quantity} aria-invalid={Boolean(quantityError(line))} aria-describedby={quantityError(line) ? `${addId}-${line.item_id}-error` : undefined} onChange={(event) => update(index, event.target.value)} />
                  <span>{line.unit_name}</span>
                </div>
                {quantityError(line) && <small id={`${addId}-${line.item_id}-error`} className="field-error">{quantityError(line)}</small>}
              </label>
              <Button type="button" variant="ghost" size="sm" aria-label={`Bỏ ${line.item_name}`}
                onClick={() => setLines((current) => current.filter((_, at) => at !== index))}>Bỏ</Button>
            </li>
          ))}
        </ul>
      )}
      {suggestionNotice && <p className="notice" role="status">{suggestionNotice}</p>}
      {catalogFailed && <div className="notice error" role="alert"><p>Chưa tải được danh mục và đơn vị vật phẩm. Các số lượng đang nhập được giữ nguyên.</p><Button type="button" variant="secondary" onClick={() => setLookupRevision(value => value + 1)}>Thử tải lại danh mục</Button></div>}
      {available.length > 0 && (
        <label className="filter supply-form__add" htmlFor={addId}>
          <span>Thêm mặt hàng</span>
          <Dropdown id={addId} value={adding} onChange={(event) => add(event.target.value)}>
            <option value="">Chọn mặt hàng…</option>
            {available.map((item) => <option key={item.id} value={item.id}>{item.name}{item.unit_name ? ` (${item.unit_name})` : ''}</option>)}
          </Dropdown>
        </label>
      )}
      {error && <p className="notice error" role="alert">{error}</p>}
      <p className="supply-open__hint">Yêu cầu được gửi tới kho do hệ thống chọn. Nhân viên kho soạn hàng; đội trưởng dùng mã nhận hàng để xác nhận bàn giao tại kho.</p>
      <div className="supply-open__actions">
        <Button type="button" variant="secondary" onClick={onCancel}>Hủy</Button>
        <Button type="submit" loading={busy} disabled={!lines.length}>Gửi yêu cầu</Button>
      </div>
    </form>
  );
}
