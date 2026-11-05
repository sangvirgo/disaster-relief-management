import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, newCommandKey } from '../../api/client';
import { label } from '../../i18n/labels';
import { confirmAction } from '../../components/confirmAction';

type Kind = 'cancel' | 'resolve';
export function AsyncRequestForm({
  requestId,
  version,
  kind,
  onCompleted,
  onStale,
}: {
  requestId: string;
  version: number;
  kind: Kind;
  onCompleted: () => void;
  onStale?: () => void;
}) {
  const [reason, setReason] = useState('');
  const [basis, setBasis] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [operationId, setOperationId] = useState('');
  const [state, setState] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const key = useRef<string | null>(null);
  const terminalHandled = useRef(false);
  const reasonError = !reason.trim()
    ? 'Lý do là bắt buộc.'
    : reason.length > 2000
      ? 'Lý do không được vượt quá 2.000 ký tự.'
      : '';
  const basisError = kind === 'resolve' && !basis ? 'Căn cứ kết thúc là bắt buộc.' : '';
  const invalid = Boolean(reasonError || basisError);
  useEffect(() => {
    if (!operationId || ['COMPLETED', 'ABORTED'].includes(state)) return;
    let active = true;
    let checking = false;
    async function check() {
      if (checking) return;
      checking = true;
      try {
        const result = await api<{ state: string }>('response', `/operations/${operationId}`);
        if (active) {
          setState(result.state);
          if (['COMPLETED', 'ABORTED'].includes(result.state) && !terminalHandled.current) {
            terminalHandled.current = true;
            key.current = null;
            onCompleted();
          }
        }
      } catch (cause) {
        if (active)
          setMessage(cause instanceof Error ? cause.message : 'Chưa tải được tiến độ xử lý.');
      } finally {
        checking = false;
      }
    }
    void check();
    const timer = window.setInterval(check, 4000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [operationId, state, onCompleted]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched({ reason: true, basis: true });
    if (invalid) return;
    if (
      !(await confirmAction(
        kind === 'cancel'
          ? 'Xác nhận hủy yêu cầu này?'
          : 'Xác nhận đề nghị kết thúc xử lý yêu cầu này?'
      ))
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      key.current ||= newCommandKey();
      const result = await api<{ operation_id: string; state: string }>(
        'response',
        `/requests/${requestId}/${kind}`,
        {
          method: 'POST',
          idempotencyKey: key.current,
          body:
            kind === 'cancel'
              ? { expected_version: version, reason: reason.trim() }
              : {
                  expected_version: version,
                  resolution_reason: reason.trim(),
                  outcome_basis: basis,
                },
        }
      );
      setOperationId(result.operation_id);
      setState(result.state);
      terminalHandled.current = false;
      setMessage('Máy chủ đã nhận lệnh xử lý. Đang kiểm tra kết quả cuối cùng.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Lệnh chưa được xác nhận.');
      if (cause instanceof ApiError && ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'].includes(cause.code)) {
        key.current = null;
        onStale?.();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack command-form" onSubmit={submit}>
      <h3>{kind === 'cancel' ? 'Hủy yêu cầu' : 'Kết thúc xử lý yêu cầu'}</h3>
      {!operationId && (
        <>
          <label>
            <span>Lý do <span className="required-mark" aria-hidden="true">*</span></span>
            <textarea
              required
              maxLength={2001}
              aria-invalid={Boolean(touched.reason && reasonError)}
              aria-describedby={touched.reason && reasonError ? 'async-request-reason-error' : undefined}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setTouched((current) => ({ ...current, reason: true }));
                key.current = null;
              }}
              onBlur={() => setTouched((current) => ({ ...current, reason: true }))}
            />
            {touched.reason && reasonError && <small className="field-error" id="async-request-reason-error" role="alert">{reasonError}</small>}
          </label>
          {kind === 'resolve' && (
            <label>
              <span>Căn cứ kết thúc <span className="required-mark" aria-hidden="true">*</span></span>
              <select
                required
                aria-invalid={Boolean(touched.basis && basisError)}
                aria-describedby={touched.basis && basisError ? 'async-request-basis-error' : undefined}
                value={basis}
                onChange={(event) => {
                  setBasis(event.target.value);
                  setTouched((current) => ({ ...current, basis: true }));
                  key.current = null;
                }}
                onBlur={() => setTouched((current) => ({ ...current, basis: true }))}
              >
                <option value="">Chọn căn cứ</option>
                <option value="RESCUE_COMPLETED">Nhiệm vụ cứu hộ đã hoàn thành</option>
                <option value="SUPPLY_ONLY">Chỉ hỗ trợ vật tư và đã bàn giao</option>
                <option value="NO_ACTION_REQUIRED">Không còn cần hành động</option>
              </select>
              {touched.basis && basisError && <small className="field-error" id="async-request-basis-error" role="alert">{basisError}</small>}
            </label>
          )}
          <button className="button" disabled={busy || invalid}>
            {busy ? 'Đang gửi lệnh…' : kind === 'cancel' ? 'Xác nhận hủy' : 'Gửi đề nghị kết thúc'}
          </button>
        </>
      )}
      {operationId && (
        <p className="notice" role="status">
          Tiến độ xử lý: {label(state)}.{' '}
          {state === 'ABORTED'
            ? 'Thao tác đã được hủy; hồ sơ trở về trạng thái trước đó.'
            : state !== 'COMPLETED' && 'Yêu cầu chưa có kết quả cuối cùng.'}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
