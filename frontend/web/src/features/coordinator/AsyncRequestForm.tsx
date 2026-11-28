import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, newCommandKey } from '../../api/client';
import { label } from '../../i18n/labels';
import { confirmAction } from '../../components/confirmAction';

type Kind = 'cancel' | 'resolve';
export type ResolveBasis = 'RESCUE_COMPLETED' | 'SUPPLY_ONLY' | 'NO_ACTION_REQUIRED';
const resolveBases: { value: ResolveBasis; title: string; hint: string; template: string }[] = [
  { value: 'RESCUE_COMPLETED', title: 'Nhiệm vụ cứu hộ đã hoàn thành', hint: 'Đội đã báo hoàn thành và minh chứng phù hợp.',
    template: 'Đội cứu hộ đã hoàn thành nhiệm vụ; đã đối chiếu báo cáo và minh chứng, người dân đã an toàn.' },
  { value: 'SUPPLY_ONLY', title: 'Chỉ hỗ trợ vật tư và đã bàn giao', hint: 'SOS chỉ cần vật tư và đã nhận đủ.',
    template: 'Yêu cầu chỉ cần hỗ trợ vật tư; vật tư đã được bàn giao cho người dân.' },
  { value: 'NO_ACTION_REQUIRED', title: 'Không còn cần hành động', hint: 'Người báo xác nhận đã ổn hoặc nhu cầu không còn.',
    template: 'Đã liên hệ xác nhận, nhu cầu hỗ trợ không còn; không cần điều thêm đội.' },
];
export function AsyncRequestForm({
  requestId,
  version,
  kind,
  hideTitle = false,
  onCompleted,
  onStale,
  blockers = [],
  suggestedBasis,
  disabledBases = {},
}: {
  requestId: string;
  version: number;
  kind: Kind;
  hideTitle?: boolean;
  onCompleted: () => void;
  onStale?: () => void;
  blockers?: { text: string; href: string }[];
  /** Pre-selected outcome basis (the coordinator still reviews it, writes the reason and confirms). */
  suggestedBasis?: ResolveBasis;
  /** Bases the backend would reject for this SOS, with the Vietnamese reason shown beside them. */
  disabledBases?: Partial<Record<ResolveBasis, string>>;
}) {
  const [reason, setReason] = useState('');
  const [basis, setBasis] = useState<string>(kind === 'resolve' ? suggestedBasis ?? '' : '');
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
            if (result.state === 'ABORTED' && onStale) onStale();
            else onCompleted();
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
  }, [operationId, state, onCompleted, onStale]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched({ reason: true, basis: true });
    if (invalid || blockers.length > 0) return;
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
              ? { expected_version: version, reason: reason.trim().normalize('NFC') }
              : {
                  expected_version: version,
                  resolution_reason: reason.trim().normalize('NFC'),
                  outcome_basis: basis,
                },
        }
      );
      setOperationId(result.operation_id);
      setState(result.state);
      terminalHandled.current = false;
      setMessage('Máy chủ đã nhận lệnh xử lý. Đang kiểm tra kết quả cuối cùng.');
      if (['COMPLETED', 'ABORTED'].includes(result.state)) {
        terminalHandled.current = true;
        key.current = null;
        if (result.state === 'ABORTED' && onStale) onStale();
        else onCompleted();
      }
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
    <form className={`form-stack command-form async-request-form async-request-form--${kind}`} data-static-label onSubmit={submit} noValidate>
      {!hideTitle && <h3>{kind === 'cancel' ? 'Hủy yêu cầu' : 'Kết thúc xử lý yêu cầu'}</h3>}
      {blockers.length > 0 && <div className="notice warning" role="status"><strong>Chưa thể kết thúc yêu cầu</strong><ul>{blockers.map(blocker => <li key={blocker.href}><a href={blocker.href}>{blocker.text}</a></li>)}</ul></div>}
      {!operationId && (
        <>
          {kind === 'resolve' && (
            <fieldset className="resolve-basis" aria-describedby={touched.basis && basisError ? 'async-request-basis-error' : undefined}>
              <legend>Căn cứ kết thúc <span className="required-mark" aria-hidden="true">*</span></legend>
              <div className="resolve-basis__options">
                {resolveBases.map((option) => {
                  const blocked = disabledBases[option.value];
                  return <label key={option.value} className={`resolve-basis__option${basis === option.value ? ' selected' : ''}${blocked ? ' disabled' : ''}`}>
                    <input type="radio" name={`resolve-basis-${requestId}`} value={option.value} checked={basis === option.value} disabled={Boolean(blocked)}
                      onChange={() => { setBasis(option.value); setTouched((current) => ({ ...current, basis: true })); key.current = null; }} />
                    <span className="resolve-basis__text" title={option.hint}>{option.title}{blocked && <small>{blocked}</small>}</span>
                  </label>;
                })}
              </div>
              {touched.basis && basisError && <small className="field-error" id="async-request-basis-error" role="alert">{basisError}</small>}
            </fieldset>
          )}
          <div className="resolve-reason">
            <div className="resolve-reason__label">
              <label htmlFor={`async-request-reason-${requestId}`}>{kind === 'resolve' ? 'Nội dung đã đối chiếu' : 'Lý do'} <span className="required-mark" aria-hidden="true">*</span></label>
              {kind === 'resolve' && resolveBases.some((option) => option.value === basis) && <button type="button" className="text-action resolve-reason__template"
                onClick={() => { setReason(resolveBases.find((option) => option.value === basis)!.template); setTouched((current) => ({ ...current, reason: true })); key.current = null; }}>
                Điền câu gợi ý</button>}
            </div>
            <textarea
              id={`async-request-reason-${requestId}`}
              required
              rows={3}
              placeholder={kind === 'resolve' ? 'Ví dụ: Đội đã đưa 12 người đến nơi an toàn, đã kiểm tra ảnh minh chứng.' : undefined}
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
            <small className="muted resolve-reason__count">{reason.length}/2000</small>
          </div>
          <button className="button async-request-form__submit" disabled={busy || invalid || blockers.length > 0}>
            {busy ? 'Đang gửi lệnh…' : kind === 'cancel' ? 'Xác nhận hủy' : 'Kết thúc xử lý SOS'}
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
