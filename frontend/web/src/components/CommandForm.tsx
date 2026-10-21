import { useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey, type Service, type HttpMethod } from '../api/client';

export type Field = {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'password' | 'textarea' | 'select' | 'datetime-local';
  required?: boolean;
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
export function CommandForm({ spec, onSuccess }: { spec: CommandSpec; onSuccess: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const key = useRef<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (spec.warning && !window.confirm(spec.warning)) return;
    setBusy(true);
    setMessage('');
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
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack command-form" onSubmit={submit}>
      <h3>{spec.title}</h3>
      {spec.fields?.map((field) => (
        <label key={field.name}>
          {field.label}
          {field.type === 'textarea' ? (
            <textarea
              required={field.required}
              placeholder={field.placeholder}
              value={values[field.name] || ''}
              onChange={(event) => {
                setValues({ ...values, [field.name]: event.target.value });
                key.current = null;
              }}
            />
          ) : field.type === 'select' ? (
            <select
              required={field.required}
              value={values[field.name] || ''}
              onChange={(event) => {
                setValues({ ...values, [field.name]: event.target.value });
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
              placeholder={field.placeholder}
              value={values[field.name] || ''}
              onChange={(event) => {
                setValues({ ...values, [field.name]: event.target.value });
                key.current = null;
              }}
            />
          )}
        </label>
      ))}
      {message && (
        <p role="status" className={message.startsWith('Thao tác đã') ? 'notice' : 'notice error'}>
          {message}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy ? 'Đang xử lý…' : spec.title}
      </button>
    </form>
  );
}
