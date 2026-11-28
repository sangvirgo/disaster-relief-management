import { useEffect, useId, useState } from 'react';
import { api } from '../../api/client';
import { fetchAll } from '../../api/fetchAll';
import { sendRetryableCommand } from '../../api/retryableCommand';
import { LIST_PAGE_SIZE, useCursorNav } from '../../api/useCursorNav';
import { DetailSurface } from '../../components/DetailSurface';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Dropdown } from '../../components/ui/Dropdown';
import { EmptyState } from '../../components/ui/EmptyState';
import { ListNav } from '../../components/ui/Pager';
import { Skeleton } from '../../components/ui/Skeleton';
import { Tabs } from '../../components/ui/Tabs';
import { timeLabel } from '../../i18n/labels';
import {
  deadlineText, isUrgent, normalizePickupCode, quantityText, supplyStatusLabels, supplyStatusTones,
  type SupplyQueuePage as QueuePage, type SupplyQueueRow, type SupplyStatus,
} from './supplyModel';
import './supply.css';

const STATUS_TABS: Array<{ id: SupplyStatus; label: string }> = [
  { id: 'READY', label: 'Chờ nhận hàng' },
  { id: 'HANDED_OVER', label: 'Đã giao' },
  { id: 'EXPIRED', label: 'Hết hạn' },
  { id: 'CANCELLED', label: 'Đã hủy' },
];

type Dialog = { mode: 'handover' | 'cancel'; row: SupplyQueueRow } | null;

/**
 * Operations: the one place where goods leave a warehouse. Teams ask for goods from their mission; the system reserves
 * them here. Staff only see the team name and the goods, hand them over when the team reads out its six-digit code, and
 * may cancel a request they cannot serve. No slips, approvals or reconciliation.
 */
export function SupplyQueuePage() {
  const filterId = useId();
  const [status, setStatus] = useState<SupplyStatus>('READY');
  const [warehouseId, setWarehouseId] = useState('');
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [rows, setRows] = useState<SupplyQueueRow[]>([]);
  const [cursor, setCursor, prevPage, pageIndex] = useCursorNav<string>('');
  const [next, setNext] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<Dialog>(null);

  useEffect(() => {
    let live = true;
    void fetchAll<{ id?: string; name?: string; status?: string }>('logistics', '/warehouses')
      .then((items) => {
        if (live) setWarehouses(items.filter((item) => item.id && item.status === 'ACTIVE').map((item) => ({ id: item.id!, name: item.name || 'Kho' })));
      })
      .catch(() => { /* The filter is optional; the queue still loads without it. */ });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ status, limit: String(LIST_PAGE_SIZE) });
    if (warehouseId) params.set('warehouse_id', warehouseId);
    if (cursor) params.set('cursor', cursor);
    api<QueuePage>('logistics', `/supply-requests/queue?${params}`)
      .then((page) => {
        if (!live) return;
        setRows(page.items);
        setNext(page.more && page.cursor ? page.cursor : '');
      })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Không tải được danh sách giao hàng.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [status, warehouseId, cursor, revision]);

  // Teams keep arriving: refresh the waiting list every 30 seconds while nothing is open.
  useEffect(() => {
    if (status !== 'READY' || dialog) return;
    const timer = window.setInterval(() => setRevision((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [status, dialog]);

  function changeStatus(value: string) {
    setRows([]);
    setNext('');
    setLoading(true);
    setStatus(value as SupplyStatus);
    setCursor('');
    setNotice('');
  }

  function finished(message: string) {
    setDialog(null);
    setNotice(message);
    setRevision((value) => value + 1);
  }

  return (
    <div className="operations-workspace supply-page">
      <section className="card supply-queue">
        <div className="supply-queue__intro"><p>Soạn hàng theo yêu cầu. Khi đội đến, nhập mã 6 số để xác nhận bàn giao.</p><Button variant="secondary" disabled={loading} onClick={() => setRevision((value) => value + 1)}>Làm mới</Button></div>
        <div className="supply-queue__toolbar">
          <Tabs items={STATUS_TABS} value={status} onChange={changeStatus} ariaLabel="Trạng thái yêu cầu hàng" idBase="supply-queue" />
          {warehouses.length > 1 && (
            <label className="filter supply-queue__filter" htmlFor={filterId}>
              <span>Kho</span>
              <Dropdown id={filterId} value={warehouseId} onChange={(event) => { setRows([]); setNext(''); setLoading(true); setWarehouseId(event.target.value); setCursor(''); }}>
                <option value="">Tất cả kho</option>
                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}
              </Dropdown>
            </label>
          )}
        </div>
        {notice && <p className="notice success" role="status">{notice}</p>}
        {error && <p className="notice error" role="alert">{error}</p>}
        <div id="supply-queue-tabpanel" role="tabpanel" aria-labelledby={`supply-queue-tab-${status}`}>
          {loading && rows.length === 0 ? <Skeleton rows={4} /> : rows.length === 0 && !error ? (
            <EmptyState
              title={status === 'READY' ? 'Chưa có đội nào chờ nhận hàng' : 'Không có yêu cầu nào'}
              description={status === 'READY'
                ? 'Khi trưởng đội gửi yêu cầu hàng từ nhiệm vụ, yêu cầu sẽ xuất hiện ở đây kèm danh sách hàng cần soạn.'
                : 'Thử chọn trạng thái hoặc kho khác.'}
            />
          ) : (
            <ul className="supply-queue__list" aria-busy={loading}>
              {rows.map((row) => <QueueCard key={row.id} row={row} disabled={loading || Boolean(error)} onHandOver={() => setDialog({ mode: 'handover', row })}
                onCancel={() => setDialog({ mode: 'cancel', row })} />)}
            </ul>
          )}
        </div>
        <ListNav page={pageIndex} hasNext={Boolean(next)} loading={loading} count={rows.length} noun="yêu cầu"
          onPrev={prevPage} onNext={() => setCursor(next)} />
      </section>
      {dialog?.mode === 'handover' && <HandOverDialog row={dialog.row} onClose={() => setDialog(null)}
        onDone={() => finished(`Đã giao hàng cho ${dialog.row.team_name}. Tồn kho đã được trừ.`)} onStale={() => { setDialog(null); setRevision((value) => value + 1); }} />}
      {dialog?.mode === 'cancel' && <CancelDialog row={dialog.row} onClose={() => setDialog(null)}
        onDone={() => finished('Đã hủy yêu cầu và trả hàng về kệ.')} />}
    </div>
  );
}

function QueueCard({ row, disabled, onHandOver, onCancel }: { row: SupplyQueueRow; disabled: boolean; onHandOver: () => void; onCancel: () => void }) {
  const urgent = row.status === 'READY' && isUrgent(row.expires_at);
  return (
    <li className={`supply-card${urgent ? ' supply-card--urgent' : ''}`}>
      <div className="supply-card__head">
        <div>
          <h3>{row.team_name}</h3>
          <p className="muted">{row.warehouse.name} · gửi lúc {timeLabel(row.created_at)}</p>
        </div>
        <div className="supply-card__state">
          <Badge tone={supplyStatusTones[row.status]}>{supplyStatusLabels[row.status]}</Badge>
          {row.status === 'READY' && <span className={urgent ? 'supply-deadline supply-deadline--urgent' : 'supply-deadline'}>{deadlineText(row.expires_at)}</span>}
          {row.status === 'HANDED_OVER' && row.handed_over_at && <span className="supply-deadline">Giao lúc {timeLabel(row.handed_over_at)}</span>}
        </div>
      </div>
      <ul className="supply-card__items" aria-label="Hàng cần soạn">
        {row.lines.map((line) => <li key={line.item_id}><span>{line.item_name}</span><strong>{quantityText(line.quantity, line.unit_name)}</strong></li>)}
        {row.lines.length === 0 && <li className="muted">Không còn hàng để giao.</li>}
      </ul>
      {row.status === 'READY' && (
        <div className="supply-card__actions">
          <Button variant="ghost" disabled={disabled} onClick={onCancel}>Không giao được</Button>
          <Button disabled={disabled} onClick={onHandOver}>Giao hàng</Button>
        </div>
      )}
    </li>
  );
}

function HandOverDialog({ row, onClose, onDone, onStale }: { row: SupplyQueueRow; onClose: () => void; onDone: () => void; onStale: () => void }) {
  const codeId = useId();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (code.length !== 6) { setError('Mã nhận hàng gồm đúng 6 chữ số.'); return; }
    setBusy(true);
    setError('');
    try {
      await sendRetryableCommand(`supply-handover:${row.id}`, 'logistics', `/supply-requests/${row.id}/hand-over`, {
        expected_version: row.version, pickup_code: code,
      });
      onDone();
    } catch (cause) {
      const failure = cause as { code?: string; message?: string };
      if (failure.code === 'VERSION_CONFLICT' || failure.code === 'STATE_TRANSITION_INVALID') { onStale(); return; }
      setError(failure.message || 'Không giao được hàng.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <DetailSurface modal open heading={`Giao hàng cho ${row.team_name}`} label="Giao hàng cho đội" onClose={onClose} className="supply-dialog">
      <form onSubmit={submit} className="supply-dialog__body" aria-busy={busy}>
        <p className="supply-dialog__warehouse">{row.warehouse.name}</p>
        <div className="supply-dialog__goods"><h3>Hàng bàn giao</h3><ul className="supply-card__items">
          {row.lines.map((line) => <li key={line.item_id}><span>{line.item_name}</span><strong>{quantityText(line.quantity, line.unit_name)}</strong></li>)}
        </ul></div>
        <div className="supply-pickup-field" data-static-label>
          <label htmlFor={codeId}>Mã nhận hàng của đội</label>
          <p id={`${codeId}-hint`}>Nhờ đội trưởng đọc mã 6 số trong nhiệm vụ.</p>
          <input id={codeId} type="text" inputMode="numeric" autoComplete="off" autoFocus maxLength={6} placeholder="••••••" disabled={busy}
            value={code} onChange={(event) => { setCode(normalizePickupCode(event.target.value)); setError(''); }} aria-invalid={Boolean(error)} aria-describedby={`${codeId}-hint${error ? ` ${codeId}-error` : ''}`} />
          {error && <p id={`${codeId}-error`} className="field-error" role="alert">{error}</p>}
        </div>
        <div className="supply-dialog__actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>Quay lại</Button>
          <Button type="submit" loading={busy} disabled={code.length !== 6}>Xác nhận đã giao</Button>
        </div>
      </form>
    </DetailSurface>
  );
}

function CancelDialog({ row, onClose, onDone }: { row: SupplyQueueRow; onClose: () => void; onDone: () => void }) {
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!reason.trim()) { setError('Vui lòng ghi lý do để đội và điều phối viên biết.'); return; }
    setBusy(true);
    setError('');
    try {
      await sendRetryableCommand(`supply-cancel:${row.id}`, 'logistics', `/supply-requests/${row.id}/cancel`, {
        expected_version: row.version, reason: reason.trim(),
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không hủy được yêu cầu.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <DetailSurface modal open heading="Không giao được hàng" label="Hủy yêu cầu hàng" onClose={onClose} className="supply-dialog">
      <form onSubmit={submit} className="supply-dialog__body">
        <p>Hàng đang giữ cho <strong>{row.team_name}</strong> sẽ trả lại kệ. Đội có thể gửi yêu cầu mới.</p>
        <label htmlFor={reasonId} className="supply-code-field">
          <span>Lý do</span>
          <textarea id={reasonId} rows={3} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)}
            placeholder="Ví dụ: hàng bị ẩm, không đủ số lượng thực tế" />
        </label>
        {error && <p className="notice error" role="alert">{error}</p>}
        <div className="supply-dialog__actions">
          <Button type="button" variant="secondary" onClick={onClose}>Quay lại</Button>
          <Button type="submit" variant="danger" loading={busy}>Hủy yêu cầu</Button>
        </div>
      </form>
    </DetailSurface>
  );
}
