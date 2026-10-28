import { useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey, type Service } from '../api/client';
import { label, timeLabel } from '../i18n/labels';

export function RecoveryIssue({
  service,
  path,
  version,
  kind,
  contacts,
}: {
  service: Service;
  path: string;
  version: number;
  kind: 'sos' | 'donation';
  contacts?: { id: string; outcome: string; contact_target: string; attempted_at?: string }[];
}) {
  const [reason, setReason] = useState('');
  const eligibleContacts = contacts?.filter(
    (item) => item.outcome === 'REACHED' && ['REPORTER', 'ALTERNATE'].includes(item.contact_target)
  ) ?? [];
  const [basis, setBasis] = useState(eligibleContacts.length === 1 ? eligibleContacts[0].id : '');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ recovery_code?: string; expires_at?: string } | null>(
    null
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!window.confirm('Bạn đã xác minh độc lập người yêu cầu khôi phục và muốn cấp mã một lần?'))
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
        <form className="form-stack" onSubmit={submit}>
          <label>
            Lý do khôi phục
            <textarea
              required
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                key.current = null;
              }}
            />
          </label>
          {kind === 'sos' ? (
            <label>
              Lần liên hệ xác nhận
              <select
                required
                value={basis}
                onChange={(event) => {
                  setBasis(event.target.value);
                  key.current = null;
                }}
              >
                <option value="">Chọn lần liên hệ</option>
                {eligibleContacts.map((item) => (
                    <option value={item.id} key={item.id}>
                      {label(item.contact_target)} · {item.attempted_at ? timeLabel(item.attempted_at) : 'Đã liên hệ'}
                    </option>
                  ))}
              </select>
            </label>
          ) : (
            <label>
              Căn cứ xác nhận liên hệ
              <input
                required
                value={basis}
                onChange={(event) => {
                  setBasis(event.target.value);
                  key.current = null;
                }}
              />
            </label>
          )}
          <label>
            Ghi chú nguồn xác minh
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
            {busy ? 'Đang cấp mã…' : 'Cấp mã khôi phục'}
          </button>
        </form>
      )}
    </section>
  );
}
