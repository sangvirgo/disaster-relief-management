import { useId, useMemo, useState } from 'react';
import type { Me } from '../../auth/session';
import { confirmAction } from '../../components/confirmAction';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { formatQuantity } from '../../i18n/quantity';
import { sendPickupCommand } from './pickupCommands';
import {
  canPickupAction,
  closeoutSavePayload,
  draftFromCloseout,
  rejectNoteError,
  reviewReturnBlock,
  selfActionBlock,
  validateCloseoutDraft,
  type CloseoutDraftLine,
  type PickupCloseout,
  type PickupPermission,
  type PickupActionKey,
  type PickupTicket,
  type RetireReason,
} from './pickupRules';
import { closeoutStatusLabels, retireReasonLabels, type CloseoutStatus } from './pickupCopy';

const RETIRE_REASONS = Object.keys(retireReasonLabels) as RetireReason[];

interface CloseoutPanelProps {
  ticket: PickupTicket;
  closeout: PickupCloseout;
  granted: ReadonlySet<PickupPermission>;
  user: Me;
  onChanged: (message: string) => Promise<void>;
  onFailed: (error: unknown, action: PickupActionKey) => void;
}

/** +/- control for a decimal quantity. Typing is allowed; the invariant check runs on every change. */
function QuantityControl({ label, value, disabled, invalid, describedBy, onChange }: {
  label: string; value: string; disabled: boolean; invalid: boolean; describedBy?: string; onChange: (value: string) => void;
}) {
  const numeric = /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : 0;
  return (
    <div className="pickup-qty">
      <button type="button" className="pickup-qty__btn" disabled={disabled || numeric <= 0}
        aria-label={`Giảm ${label}`} onClick={() => onChange(String(Math.max(0, numeric - 1)))}>−</button>
      <input type="text" inputMode="decimal" className="pickup-qty__input" value={value} disabled={disabled}
        aria-label={label} aria-invalid={invalid} aria-describedby={describedBy} autoComplete="off"
        onChange={(event) => onChange(event.target.value)} />
      <button type="button" className="pickup-qty__btn" disabled={disabled}
        aria-label={`Tăng ${label}`} onClick={() => onChange(String(numeric + 1))}>+</button>
    </div>
  );
}

export function CloseoutPanel({ ticket, closeout, granted, user, onChanged, onFailed }: CloseoutPanelProps) {
  const idBase = useId();
  const initial = useMemo(() => draftFromCloseout(closeout.lines), [closeout]);
  const [draft, setDraft] = useState<CloseoutDraftLine[]>(initial);
  const [snapshot] = useState(() => JSON.stringify(initial));
  const [busy, setBusy] = useState<PickupActionKey | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectError, setRejectError] = useState('');

  const status = (closeout.closeout_status ?? null) as CloseoutStatus | null;
  const editable = closeout.editable && canPickupAction('closeoutSave', granted);
  const issues = validateCloseoutDraft(draft);
  const issueCount = Object.keys(issues).length;
  const dirty = JSON.stringify(draft) !== snapshot;
  const canSave = editable && issueCount === 0 && (status === null || status === 'DRAFT');
  const canSubmit = editable && canPickupAction('closeoutSubmit', granted) && closeout.can_submit
    && status === 'DRAFT' && closeout.version > 0 && !dirty && issueCount === 0;
  const showReview = status === 'SUBMITTED' && canPickupAction('closeoutReview', granted);
  const selfBlock = selfActionBlock('review', user.id, ticket);
  const returnBlock = reviewReturnBlock(granted, closeout.lines);
  const rejectedBefore = status === 'DRAFT' && Boolean(closeout.review_note) && Boolean(closeout.reviewed_at);

  function patch(itemId: string, change: Partial<CloseoutDraftLine>) {
    setDraft((current) => current.map((line) => (line.item_id === itemId ? { ...line, ...change } : line)));
  }

  async function save() {
    setBusy('closeoutSave');
    try {
      await sendPickupCommand(`closeout-save:${ticket.id}`, `/pickup-tickets/${ticket.id}/closeout`,
        { expected_version: closeout.version, lines: closeoutSavePayload(draft) }, 'PUT');
      await onChanged('Đã lưu nháp phiếu đối soát.');
    } catch (error) {
      onFailed(error, 'closeoutSave');
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    const confirmed = await confirmAction('Gửi phiếu đối soát để duyệt? Khi đang chờ duyệt, không thể ghi nhận thêm giao hàng.');
    if (!confirmed) return;
    setBusy('closeoutSubmit');
    try {
      await sendPickupCommand(`closeout-submit:${ticket.id}`, `/pickup-tickets/${ticket.id}/closeout/submit`,
        { expected_version: closeout.version });
      await onChanged('Đã gửi phiếu đối soát để duyệt.');
    } catch (error) {
      onFailed(error, 'closeoutSubmit');
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    const confirmed = await confirmAction('Duyệt phiếu đối soát? Hàng trả về sẽ nhập kho và phiếu lấy hàng sẽ được đóng.');
    if (!confirmed) return;
    setBusy('closeoutReview');
    try {
      await sendPickupCommand(`closeout-review:${ticket.id}`, `/pickup-tickets/${ticket.id}/closeout/review`,
        { expected_version: closeout.version, decision: 'APPROVE' });
      await onChanged('Đã duyệt phiếu đối soát. Phiếu lấy hàng đã đóng.');
    } catch (error) {
      onFailed(error, 'closeoutReview');
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    const problem = rejectNoteError(rejectNote);
    if (problem) { setRejectError(problem); return; }
    setRejectError('');
    setBusy('closeoutReview');
    try {
      await sendPickupCommand(`closeout-review:${ticket.id}`, `/pickup-tickets/${ticket.id}/closeout/review`,
        { expected_version: closeout.version, decision: 'REJECT', note: rejectNote.trim() });
      await onChanged('Đã từ chối phiếu đối soát. Phiếu đã trở về bản nháp.');
    } catch (error) {
      onFailed(error, 'closeoutReview');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card pickup-subcard" aria-labelledby={`${idBase}-title`}>
      <header className="pickup-subcard__header">
        <h3 id={`${idBase}-title`} className="pickup-subcard__title">Đối soát hàng</h3>
        <Badge tone={status === 'APPROVED' ? 'success' : status === 'SUBMITTED' ? 'warning' : 'neutral'}>
          {status ? closeoutStatusLabels[status] : 'Chưa lập phiếu'}
        </Badge>
      </header>

      {rejectedBefore && (
        <p className="notice warning pickup-notice" role="status">
          Phiếu đã bị từ chối. Ghi chú của người duyệt: {closeout.review_note}
        </p>
      )}
      {!rejectedBefore && status && status !== 'DRAFT' && closeout.review_note && (
        <p className="pickup-muted">Ghi chú duyệt: {closeout.review_note}</p>
      )}

      <div className="pickup-table-wrap">
        <table className="pickup-table pickup-table--closeout">
          <caption className="pickup-visually-hidden">Số liệu đối soát theo mặt hàng</caption>
          <thead>
            <tr>
              <th scope="col">Mặt hàng</th>
              <th scope="col" className="pickup-num">Đã giữ</th>
              <th scope="col" className="pickup-num">Đã giao</th>
              <th scope="col" className="pickup-num">Còn lại</th>
              <th scope="col">Trả về kho</th>
              <th scope="col">Hủy</th>
              <th scope="col">Lý do hủy</th>
            </tr>
          </thead>
          <tbody>
            {draft.map((line) => {
              const source = closeout.lines.find((item) => item.item_id === line.item_id);
              const issue = issues[line.item_id];
              const issueId = `${idBase}-${line.item_id}-issue`;
              const returnDisabled = !editable || !line.returnable || line.perishable;
              const remaining = source?.remaining_quantity ?? '0';
              return (
                <tr key={line.item_id}>
                  <th scope="row">
                    {line.item_name}
                    <span className="pickup-muted"> ({line.unit_code})</span>
                    {!line.returnable && <span className="pickup-muted"> · Không nhập lại kho</span>}
                    {line.perishable && <span className="pickup-muted"> · Dễ hỏng</span>}
                    {issue && <span id={issueId} className="pickup-field-error">{issue}</span>}
                  </th>
                  <td className="pickup-num">{formatQuantity(line.held)}</td>
                  <td className="pickup-num">{formatQuantity(line.delivered)}</td>
                  <td className="pickup-num">{formatQuantity(remaining)}</td>
                  <td>
                    {editable ? (
                      <QuantityControl label={`trả về kho: ${line.item_name}`} value={line.returned}
                        disabled={returnDisabled} invalid={Boolean(issue)} describedBy={issue ? issueId : undefined}
                        onChange={(value) => patch(line.item_id, { returned: value })} />
                    ) : formatQuantity(line.returned)}
                  </td>
                  <td>
                    {editable ? (
                      <QuantityControl label={`hủy: ${line.item_name}`} value={line.retired}
                        disabled={false} invalid={Boolean(issue)} describedBy={issue ? issueId : undefined}
                        onChange={(value) => patch(line.item_id, { retired: value })} />
                    ) : formatQuantity(line.retired)}
                  </td>
                  <td>
                    {editable ? (
                      <select aria-label={`Lý do hủy: ${line.item_name}`} value={line.retire_reason ?? ''}
                        aria-invalid={Boolean(issue) && Number(line.retired) > 0 && !line.retire_reason}
                        onChange={(event) => patch(line.item_id, {
                          retire_reason: (event.target.value || null) as RetireReason | null,
                        })}>
                        <option value="">Chọn lý do</option>
                        {RETIRE_REASONS.map((reason) => (
                          <option key={reason} value={reason}>{retireReasonLabels[reason]}</option>
                        ))}
                      </select>
                    ) : (line.retire_reason ? retireReasonLabels[line.retire_reason] : '—')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {issueCount > 0 && (
        <p className="notice warning pickup-notice" role="status" aria-live="polite">
          Còn {issueCount} mặt hàng chưa cân bằng. Hãy sửa trước khi lưu nháp hoặc gửi duyệt.
        </p>
      )}
      {issueCount === 0 && dirty && editable && (
        <p className="pickup-muted" role="status">Có thay đổi chưa lưu. Hãy lưu nháp trước khi gửi duyệt.</p>
      )}

      {editable && (
        <div className="pickup-form-actions">
          <Button variant="secondary" loading={busy === 'closeoutSave'} disabled={busy !== null || !canSave}
            onClick={() => void save()}>Lưu nháp</Button>
          {canPickupAction('closeoutSubmit', granted) && status === 'DRAFT' && (
            <Button loading={busy === 'closeoutSubmit'} disabled={busy !== null || !canSubmit}
              onClick={() => void submit()}>Gửi duyệt</Button>
          )}
        </div>
      )}

      {showReview && (
        <div className="pickup-review">
          <h4 className="pickup-review__title">Duyệt phiếu đối soát</h4>
          {selfBlock && <p className="pickup-hint">{selfBlock}</p>}
          {returnBlock && <p className="pickup-hint">{returnBlock}</p>}
          <div className="pickup-form-actions">
            {!rejectOpen && (
              <Button variant="secondary" disabled={busy !== null || Boolean(selfBlock)}
                onClick={() => { setRejectOpen(true); setRejectError(''); }}>Từ chối</Button>
            )}
            <Button loading={busy === 'closeoutReview' && !rejectOpen} disabled={busy !== null || Boolean(selfBlock) || Boolean(returnBlock)}
              onClick={() => void approve()}>Duyệt</Button>
          </div>
          {rejectOpen && (
            <form className="pickup-form" noValidate onSubmit={(event) => { event.preventDefault(); void reject(); }}>
              <div className="pickup-field">
                <label htmlFor={`${idBase}-reject`}>Lý do từ chối <span aria-hidden="true">*</span></label>
                <textarea id={`${idBase}-reject`} rows={3} value={rejectNote} required aria-required="true"
                  aria-invalid={Boolean(rejectError)} aria-describedby={rejectError ? `${idBase}-reject-error` : undefined}
                  onChange={(event) => setRejectNote(event.target.value)} />
                {rejectError && <p id={`${idBase}-reject-error`} className="pickup-field-error">{rejectError}</p>}
              </div>
              <div className="pickup-form-actions">
                <Button variant="secondary" disabled={busy !== null} onClick={() => { setRejectOpen(false); setRejectError(''); }}>Quay lại</Button>
                <Button type="submit" variant="danger" loading={busy === 'closeoutReview'} disabled={busy !== null}>Xác nhận từ chối</Button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
