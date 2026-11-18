import { useId, useMemo, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { formatQuantity } from '../../i18n/quantity';
import { sendPickupCommand } from './pickupCommands';
import { localDateTimeValue, validateDelivery, type DeliveryDraftLine, type PickupCloseout } from './pickupRules';

export interface DeliveryFormProps {
  ticketId: string;
  ticketVersion: number;
  closeout: PickupCloseout | null;
  closeoutError: string;
  onSaved: (message: string) => Promise<void>;
  onFailed: (error: unknown) => void;
}

/** Records goods handed to households on scene. Each quantity is capped at what the team still holds. */
export function DeliveryForm({ ticketId, ticketVersion, closeout, closeoutError, onSaved, onFailed }: DeliveryFormProps) {
  const formId = useId();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [receiver, setReceiver] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => localDateTimeValue(new Date()));
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  const lines: DeliveryDraftLine[] = useMemo(() => (closeout?.lines ?? [])
    .filter((line) => Number(line.remaining_quantity) > 0)
    .map((line) => ({
      item_id: line.item_id,
      item_name: line.item_name,
      unit_code: line.unit_code,
      remaining: line.remaining_quantity,
      quantity: quantities[line.item_id] ?? '',
    })), [closeout, quantities]);

  const validation = validateDelivery(lines, occurredAt, new Date());
  const closeoutSubmitted = closeout?.closeout_status === 'SUBMITTED';
  const showErrors = attempted;

  if (closeoutError) return <p className="notice pickup-notice" role="status">{closeoutError}</p>;
  if (!closeout) return <p className="pickup-muted" role="status">Đang tải số liệu hàng đang giữ…</p>;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (!validation.valid) return;
    setBusy(true);
    try {
      await sendPickupCommand(`deliveries:${ticketId}`, `/pickup-tickets/${ticketId}/deliveries`, {
        expected_version: ticketVersion,
        occurred_at: new Date(occurredAt).toISOString(),
        ...(receiver.trim() ? { receiver_label: receiver.trim() } : {}),
        lines: validation.lines,
      });
      setQuantities({});
      setReceiver('');
      setAttempted(false);
      await onSaved('Đã ghi nhận giao hàng cho hộ dân.');
    } catch (error) {
      onFailed(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card pickup-subcard" aria-labelledby={`${formId}-title`}>
      <h3 id={`${formId}-title`} className="pickup-subcard__title">Ghi nhận giao hàng cho hộ dân</h3>
      {closeoutSubmitted ? (
        <p className="notice warning pickup-notice" role="status">
          Phiếu đối soát đang chờ duyệt nên chưa thể ghi nhận thêm giao hàng.
        </p>
      ) : lines.length === 0 ? (
        <p className="pickup-muted">Không còn hàng đang giữ để giao.</p>
      ) : (
        <form className="pickup-form" noValidate onSubmit={(event) => void submit(event)}>
          <div className="pickup-field">
            <label htmlFor={`${formId}-occurred`}>Thời điểm giao hàng <span aria-hidden="true">*</span></label>
            <input id={`${formId}-occurred`} type="datetime-local" value={occurredAt} required aria-required="true"
              aria-invalid={showErrors && Boolean(validation.fieldErrors.occurred_at)}
              aria-describedby={showErrors && validation.fieldErrors.occurred_at ? `${formId}-occurred-error` : undefined}
              onChange={(event) => setOccurredAt(event.target.value)} />
            {showErrors && validation.fieldErrors.occurred_at && (
              <p id={`${formId}-occurred-error`} className="pickup-field-error">{validation.fieldErrors.occurred_at}</p>
            )}
          </div>

          <div className="pickup-field">
            <label htmlFor={`${formId}-receiver`}>Người nhận tại điểm giao (không bắt buộc)</label>
            <input id={`${formId}-receiver`} type="text" value={receiver} autoComplete="off"
              onChange={(event) => setReceiver(event.target.value)} />
          </div>

          <fieldset className="pickup-fieldset">
            <legend>Số lượng đã giao</legend>
            {lines.map((line) => {
              const errorKey = `quantity:${line.item_id}`;
              const error = showErrors ? validation.fieldErrors[errorKey] : undefined;
              const helpId = `${formId}-${line.item_id}-help`;
              const errorId = `${formId}-${line.item_id}-error`;
              return (
                <div className="pickup-field" key={line.item_id}>
                  <label htmlFor={`${formId}-${line.item_id}`}>
                    {line.item_name} <span className="pickup-muted">(đang giữ {formatQuantity(line.remaining)} {line.unit_code})</span>
                  </label>
                  <div className="pickup-input-row">
                    <input id={`${formId}-${line.item_id}`} type="text" inputMode="decimal" value={line.quantity}
                      aria-describedby={[helpId, error ? errorId : ''].filter(Boolean).join(' ')}
                      aria-invalid={Boolean(error)} autoComplete="off"
                      onChange={(event) => setQuantities((current) => ({ ...current, [line.item_id]: event.target.value }))} />
                    <span className="pickup-unit">{line.unit_code}</span>
                  </div>
                  <p id={helpId} className="pickup-muted">Để trống nếu không giao mặt hàng này.</p>
                  {error && <p id={errorId} className="pickup-field-error">{error}</p>}
                </div>
              );
            })}
          </fieldset>

          {showErrors && validation.formError && <p className="pickup-field-error" role="alert">{validation.formError}</p>}

          <div className="pickup-form-actions">
            <Button type="submit" loading={busy} disabled={busy}>Ghi nhận giao hàng</Button>
          </div>
        </form>
      )}
    </section>
  );
}
