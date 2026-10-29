import { useRef, useState, type FormEvent } from 'react';
import { api, ApiError, newCommandKey, type Service, type HttpMethod } from '../api/client';
import { LocationPicker } from '../maps/LocationPicker';

export type Field = {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'password' | 'textarea' | 'select' | 'choice-cards' | 'datetime-local' | 'location' | 'reference';
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  integer?: boolean;
  options?: { value: string; label: string }[];
  emptyLabel?: string;
  placeholder?: string;
  initialValue?: string;
};
export interface CommandSpec {
  title: string;
  service: Service;
  path: string;
  method?: HttpMethod;
  fields?: Field[];
  version?: number;
  warning?: string;
  build?: (values: Record<string, string>) => Record<string, unknown>;
}
const sentenceLabel = (value: string) =>
  value.charAt(0).toLocaleLowerCase('vi-VN') + value.slice(1);
function pointValue(value: string) {
  const [longitude, latitude] = value.split(',').map(Number);
  return Number.isFinite(longitude) && Number.isFinite(latitude) && value.includes(',')
    ? { longitude, latitude }
    : null;
}
export function CommandForm({
  spec,
  onSuccess,
  onStale,
}: {
  spec: CommandSpec;
  onSuccess: () => void;
  onStale?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((spec.fields || []).filter((field) => field.initialValue)
      .map((field) => [field.name, field.initialValue!]))
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [manualFields, setManualFields] = useState<Record<string, boolean>>({});
  const key = useRef<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const invalid: Record<string, string> = {};
    for (const field of spec.fields || []) {
      const value = (values[field.name] || '').trim();
      if (field.required && !value)
        invalid[field.name] =
          `Vui lòng ${['select', 'reference', 'choice-cards'].includes(field.type || '') ? 'chọn' : 'nhập'} ${sentenceLabel(field.label)}.`;
      else if (value && field.minLength && value.length < field.minLength)
        invalid[field.name] = `${field.label} cần ít nhất ${field.minLength} ký tự.`;
      else if (value && field.maxLength && value.length > field.maxLength)
        invalid[field.name] = `${field.label} không được quá ${field.maxLength} ký tự.`;
      else if (value && field.type === 'number') {
        const number = Number(value);
        const min = field.min ?? 1;
        if (!Number.isFinite(number)) invalid[field.name] = `${field.label} phải là số hợp lệ.`;
        else if (number < min) invalid[field.name] = `${field.label} phải từ ${min} trở lên.`;
        else if (field.max !== undefined && number > field.max)
          invalid[field.name] = `${field.label} không được vượt quá ${field.max}.`;
        else if ((field.integer || field.name === 'work_cycle') && !Number.isInteger(number))
          invalid[field.name] = `${field.label} phải là số nguyên.`;
      }
    }
    setFieldErrors(invalid);
    if (Object.keys(invalid).length) {
      setMessage('Hãy kiểm tra các trường được đánh dấu.');
      return;
    }
    if (spec.warning && !window.confirm(spec.warning)) return;
    setBusy(true);
    setMessage('');
    setFieldErrors({});
    try {
      key.current ||= newCommandKey();
      const body = spec.build
        ? spec.build(values)
        : Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== ''));
      if (spec.version !== undefined) body.expected_version = spec.version;
      await api(spec.service, spec.path, {
        method: spec.method || 'POST',
        body,
        idempotencyKey: key.current,
      });
      key.current = null;
      setMessage('Thao tác đã được máy chủ xác nhận.');
      onSuccess();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Thao tác chưa được xác nhận.');
      if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length) {
        const errors: Record<string, string> = {};
        for (const field of spec.fields || []) {
          if (
            Object.keys(cause.fieldErrors).some(
              (name) => name === field.name || name.endsWith(`.${field.name}`)
            )
          )
            errors[field.name] = field.name === 'region_code' && spec.path === '/campaigns'
              ? 'Khu vực này chưa được cấu hình cho điều phối. Hãy chọn khu vực khác hoặc không gắn khu vực.'
              : `Vui lòng kiểm tra ${sentenceLabel(field.label)}.`;
        }
        setFieldErrors(errors);
      }
      if (
        cause instanceof ApiError &&
        ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'].includes(cause.code)
      ) {
        key.current = null;
        onStale?.();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack command-form" onSubmit={submit} noValidate>
      <h3>{spec.title}</h3>
      {spec.fields?.map((field) =>
        field.type === 'choice-cards' ? (
          <fieldset key={field.name} className="command-choice-list" aria-invalid={Boolean(fieldErrors[field.name])}>
            <legend>{field.label}{field.required && <> <span className="required-mark" aria-hidden="true">*</span></>}</legend>
            {field.options?.length ? field.options.map((option) => (
              <button
                type="button"
                key={option.value}
                className={`command-choice-card ${values[field.name] === option.value ? 'selected' : ''}`}
                aria-pressed={values[field.name] === option.value}
                onClick={() => {
                  setValues((current) => ({ ...current, [field.name]: option.value }));
                  setFieldErrors((current) => ({ ...current, [field.name]: '' }));
                  setMessage('');
                  key.current = null;
                }}
              >
                <span>{option.label}</span>
                <span aria-hidden="true">{values[field.name] === option.value ? '✓' : '○'}</span>
              </button>
            )) : <p className="empty">Chưa có chiến dịch đang hoạt động phù hợp với khu vực này.</p>}
            {fieldErrors[field.name] && <small className="field-error" role="alert">{fieldErrors[field.name]}</small>}
          </fieldset>
        ) : field.type === 'reference' ? (
          <div key={field.name} className="form-stack">
            <label htmlFor={`reference-${field.name}`}>
              <span>{field.label}{field.required && <> <span className="required-mark" aria-hidden="true"> *</span></>}</span>
            </label>
            {field.options?.length && !manualFields[field.name] &&
            (!values[field.name] || field.options.some((option) => option.value === values[field.name])) ? (
              <select
                id={`reference-${field.name}`}
                required={field.required}
                aria-invalid={Boolean(fieldErrors[field.name])}
                value={values[field.name] || ''}
                onChange={(event) => {
                  if (event.target.value === '__manual__') {
                    setManualFields((current) => ({ ...current, [field.name]: true }));
                    setValues((current) => ({ ...current, [field.name]: '' }));
                  } else {
                    setValues((current) => ({ ...current, [field.name]: event.target.value }));
                  }
                  setFieldErrors((current) => ({ ...current, [field.name]: '' }));
                  setMessage('');
                  key.current = null;
                }}
              >
                <option value="">Chọn {sentenceLabel(field.label)}</option>
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
                <option value="__manual__">Không thấy trong danh sách? Nhập mã</option>
              </select>
            ) : (
              <>
                <input
                  id={`reference-${field.name}`}
                  required={field.required}
                  aria-invalid={Boolean(fieldErrors[field.name])}
                  placeholder={field.placeholder || 'Dán mã bản ghi'}
                  value={values[field.name] || ''}
                  onChange={(event) => {
                    setValues((current) => ({ ...current, [field.name]: event.target.value }));
                    setFieldErrors((current) => ({ ...current, [field.name]: '' }));
                    setMessage('');
                    key.current = null;
                  }}
                />
                {Boolean(field.options?.length) && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setManualFields((current) => ({ ...current, [field.name]: false }));
                      setValues((current) => ({ ...current, [field.name]: '' }));
                    }}
                  >
                    Chọn từ danh sách
                  </button>
                )}
              </>
            )}
            {fieldErrors[field.name] && (
              <small className="field-error" role="alert">{fieldErrors[field.name]}</small>
            )}
          </div>
        ) : field.type === 'location' ? (
          <div key={field.name} className="form-stack">
            <strong>{field.label}{field.required && <> <span className="required-mark" aria-hidden="true">*</span></>}</strong>
            <LocationPicker
              value={pointValue(values[field.name] || '')}
              onSelect={(point) => {
                setValues((current) => ({
                  ...current,
                  [field.name]: point ? `${point.longitude},${point.latitude}` : '',
                }));
                setFieldErrors((current) => ({ ...current, [field.name]: '' }));
                setMessage('');
                key.current = null;
              }}
            />
            {pointValue(values[field.name] || '') && (
              <small>Vị trí đã chọn: {pointValue(values[field.name] || '')?.latitude.toFixed(6)}, {pointValue(values[field.name] || '')?.longitude.toFixed(6)}</small>
            )}
            {fieldErrors[field.name] && (
              <small className="field-error" role="alert">{fieldErrors[field.name]}</small>
            )}
          </div>
        ) : (
        <label key={field.name}>
          <span>{field.label}{field.required && <> <span className="required-mark" aria-hidden="true"> *</span></>}</span>
          {field.type === 'textarea' ? (
            <textarea
              required={field.required}
              minLength={field.minLength}
              maxLength={field.maxLength}
              aria-invalid={Boolean(fieldErrors[field.name])}
              placeholder={field.placeholder}
              value={values[field.name] || ''}
              onChange={(event) => {
                setValues({ ...values, [field.name]: event.target.value });
                setFieldErrors((current) => ({ ...current, [field.name]: '' }));
                setMessage('');
                key.current = null;
              }}
            />
          ) : field.type === 'select' ? (
            <select
              required={field.required}
              aria-invalid={Boolean(fieldErrors[field.name])}
              value={values[field.name] || ''}
              onChange={(event) => {
                setValues({ ...values, [field.name]: event.target.value });
                setFieldErrors((current) => ({ ...current, [field.name]: '' }));
                setMessage('');
                key.current = null;
              }}
            >
              <option value="">{field.emptyLabel || `Chọn ${sentenceLabel(field.label)}`}</option>
              {field.options?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              required={field.required}
              type={field.type || 'text'}
              min={field.type === 'number' ? (field.min ?? 1) : undefined}
              max={field.type === 'number' ? field.max : undefined}
              step={
                field.type === 'number'
                  ? field.integer || field.name === 'work_cycle'
                    ? '1'
                    : 'any'
                  : undefined
              }
              minLength={field.minLength}
              maxLength={field.maxLength}
              aria-invalid={Boolean(fieldErrors[field.name])}
              placeholder={field.placeholder}
              value={values[field.name] || ''}
              onChange={(event) => {
                setValues({ ...values, [field.name]: event.target.value });
                setFieldErrors((current) => ({ ...current, [field.name]: '' }));
                setMessage('');
                key.current = null;
              }}
            />
          )}
          {fieldErrors[field.name] && (
            <small className="field-error">{fieldErrors[field.name]}</small>
          )}
        </label>
        )
      )}
      {message && (
        <p
          role={message.startsWith('Thao tác đã') ? 'status' : 'alert'}
          className={message.startsWith('Thao tác đã') ? 'notice' : 'notice error'}
        >
          {message}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy ? 'Đang xử lý…' : spec.title}
      </button>
    </form>
  );
}
