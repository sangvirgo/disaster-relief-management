import { useRef, useState, type FormEvent } from 'react';
import { api, ApiError, newCommandKey, type Service, type HttpMethod } from '../api/client';

export type Field = {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'password' | 'textarea' | 'select' | 'datetime-local';
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  integer?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
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
export function CommandForm({ spec, onSuccess, onStale }: { spec: CommandSpec; onSuccess: () => void; onStale?: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const key = useRef<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const invalid: Record<string, string> = {};
    for (const field of spec.fields || []) {
      const value = (values[field.name] || '').trim();
      if (field.required && !value) invalid[field.name] = `Vui lòng ${field.type === 'select' ? 'chọn' : 'nhập'} ${field.label.toLowerCase()}.`;
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
          if (Object.keys(cause.fieldErrors).some((name) => name === field.name || name.endsWith(`.${field.name}`)))
            errors[field.name] = `Vui lòng kiểm tra ${field.label.toLowerCase()}.`;
        }
        setFieldErrors(errors);
      }
      if (cause instanceof ApiError &&
          ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID'].includes(cause.code)) {
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
      {spec.fields?.map((field) => (
        <label key={field.name}>
          {field.label}
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
              <option value="">Chọn giá trị</option>
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
              min={field.type === 'number' ? field.min ?? 1 : undefined}
              max={field.type === 'number' ? field.max : undefined}
              step={field.type === 'number' ? (field.integer || field.name === 'work_cycle' ? '1' : 'any') : undefined}
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
          {fieldErrors[field.name] && <small className="field-error">{fieldErrors[field.name]}</small>}
        </label>
      ))}
      {message && (
        <p role={message.startsWith('Thao tác đã') ? 'status' : 'alert'} className={message.startsWith('Thao tác đã') ? 'notice' : 'notice error'}>
          {message}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy ? 'Đang xử lý…' : spec.title}
      </button>
    </form>
  );
}
