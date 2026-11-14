import { useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey, type Service } from '../api/client';
import { label, timeLabel } from '../i18n/labels';
import { confirmAction } from './confirmAction';

export function RecoveryIssue({
  service,
  path,
  version,
  kind,
  contacts,
  currentUserId,
}: {
  service: Service;
  path: string;
  version: number;
  kind: 'sos' | 'donation';
  contacts?: { id: string; outcome: string; contact_target: string; actor_user_id?: string | null; attempted_at?: string }[];
  currentUserId?: string;
}) {
  const [reason, setReason] = useState('');
  const eligibleContacts = contacts?.filter(
    (item) => item.outcome === 'REACHED' && item.contact_target === 'REPORTER'
      && item.actor_user_id !== currentUserId
  ) ?? [];
  const [basis, setBasis] = useState(eligibleContacts.length === 1 ? eligibleContacts[0].id : '');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ recovery_code?: string; expires_at?: string } | null>(
    null
  );
  const [error, setError] = useState('');
  const [fieldTouched, setFieldTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);
  const reasonError = !reason.trim()
    ? 'Lý do khôi phục là bắt buộc.'
    : reason.length > 1000
      ? 'Lý do khôi phục không được vượt quá 1.000 ký tự.'
      : '';
  const basisError = !basis.trim()
    ? `${kind === 'sos' ? 'Lần liên hệ xác nhận' : 'Căn cứ xác nhận liên hệ'} là bắt buộc.`
    : kind === 'donation' && basis.length > 1000
      ? 'Căn cứ xác nhận liên hệ không được vượt quá 1.000 ký tự.'
      : '';
  const noteError = note.length > 1000 ? 'Ghi chú không được vượt quá 1.000 ký tự.' : '';
  const invalid = Boolean(reasonError || basisError || noteError);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setFieldTouched({ reason: true, basis: true, note: true });
    if (invalid) return;
    if (!(await confirmAction('Bạn đã xác minh độc lập người yêu cầu khôi phục và muốn cấp mã một lần?')))
      return;
    setBusy(true);
    setError('');
    try {
      key.current ||= newCommandKey();
      const value = await api<{ recovery_code?: string; expires_at?: string }>(service, path, {
        method: 'POST',
        idempotencyKey: key.current,
        body:
          kind === 'sos'
            ? {
                expected_version: version,
                reason: reason.trim(),
                contact_attempt_id: basis,
                ...(note.trim() ? { source_note: note.trim() } : {}),
              }
            : {
                expected_version: version,
                reason: reason.trim(),
                confirmation_basis: basis.trim(),
                ...(note.trim() ? { source_note: note.trim() } : {}),
              },
      });
      setResult(value);
      key.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa cấp được mã khôi phục.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="command-form">
      <h3>Cấp mã khôi phục một lần</h3>
      <p>Chỉ cấp sau khi đã kiểm tra liên hệ độc lập. Mã hết hạn sau 30 phút.</p>
      {result ? (
        <div className="notice warning" role="status">
          {result.recovery_code ? (
            <>
              <p>Chuyển mã này cho đúng người yêu cầu qua kênh đã xác minh:</p>
              <strong className="secret">{result.recovery_code}</strong>
            </>
          ) : (
            <p>
              Máy chủ đã ghi nhận lần cấp mã. Mã không được trả lại khi gửi lại cùng yêu cầu; cần
              xác minh và cấp lần mới nếu đã mất.
            </p>
          )}
          {result.expires_at && <p>Hết hạn: {timeLabel(result.expires_at)}</p>}
        </div>
      ) : (
        <form className="form-stack" onSubmit={submit} noValidate>
          <label>
            <span>Lý do khôi phục <span className="required-mark" aria-hidden="true">*</span></span>
            <textarea
              required
              maxLength={1001}
              aria-invalid={Boolean(fieldTouched.reason && reasonError)}
              aria-describedby={fieldTouched.reason && reasonError ? 'recovery-reason-error' : undefined}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setFieldTouched((current) => ({ ...current, reason: true }));
                key.current = null;
              }}
              onBlur={() => setFieldTouched((current) => ({ ...current, reason: true }))}
            />
            {fieldTouched.reason && reasonError && <small className="field-error" id="recovery-reason-error" role="alert">{reasonError}</small>}
          </label>
          {kind === 'sos' ? (
            <label>
              <span>Lần liên hệ xác nhận <span className="required-mark" aria-hidden="true">*</span></span>
              <select
                required
                aria-invalid={Boolean(fieldTouched.basis && basisError)}
                aria-describedby={fieldTouched.basis && basisError ? 'recovery-basis-error' : undefined}
                value={basis}
                onChange={(event) => {
                  setBasis(event.target.value);
                  setFieldTouched((current) => ({ ...current, basis: true }));
                  key.current = null;
                }}
                onBlur={() => setFieldTouched((current) => ({ ...current, basis: true }))}
              >
                <option value="">Chọn lần liên hệ</option>
                {eligibleContacts.map((item) => (
                    <option value={item.id} key={item.id}>
                      {label(item.contact_target)} · {item.attempted_at ? timeLabel(item.attempted_at) : 'Đã liên hệ'}
                    </option>
                  ))}
              </select>
              {fieldTouched.basis && basisError && <small className="field-error" id="recovery-basis-error" role="alert">{basisError}</small>}
            </label>
          ) : (
            <label>
              <span>Căn cứ xác nhận liên hệ <span className="required-mark" aria-hidden="true">*</span></span>
              <input
                required
                maxLength={1001}
                aria-invalid={Boolean(fieldTouched.basis && basisError)}
                aria-describedby={fieldTouched.basis && basisError ? 'recovery-basis-error' : undefined}
                value={basis}
                onChange={(event) => {
                  setBasis(event.target.value);
                  setFieldTouched((current) => ({ ...current, basis: true }));
                  key.current = null;
                }}
                onBlur={() => setFieldTouched((current) => ({ ...current, basis: true }))}
              />
              {fieldTouched.basis && basisError && <small className="field-error" id="recovery-basis-error" role="alert">{basisError}</small>}
            </label>
          )}
          <label>
            Ghi chú nguồn xác minh
            <textarea
              maxLength={1001}
              aria-invalid={Boolean(fieldTouched.note && noteError)}
              aria-describedby={fieldTouched.note && noteError ? 'recovery-note-error' : undefined}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setFieldTouched((current) => ({ ...current, note: true }));
                key.current = null;
              }}
              onBlur={() => setFieldTouched((current) => ({ ...current, note: true }))}
            />
            {fieldTouched.note && noteError && <small className="field-error" id="recovery-note-error" role="alert">{noteError}</small>}
          </label>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <button className="button" disabled={busy || invalid}>
            {busy ? 'Đang cấp mã…' : 'Cấp mã khôi phục'}
          </button>
        </form>
      )}
    </section>
  );
}
