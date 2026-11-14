import { useId, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, newCommandKey, type Service, type HttpMethod } from '../api/client';
import { LocationPicker } from '../maps/LocationPicker';
import { confirmAction } from './confirmAction';

export type Field = {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'password' | 'textarea' | 'select' | 'choice-cards' | 'datetime-local' | 'location' | 'reference';
  required?: boolean;
  requiredWhen?: { field: string; values: string[] };
  min?: number;
  max?: number;
  scaleFor?: (values: Record<string, string>) => number | undefined;
  visibleFor?: (values: Record<string, string>) => boolean;
  maxFor?: (values: Record<string, string>) => number | undefined;
  minLength?: number;
  pattern?: RegExp;
  patternMessage?: string;
  maxLength?: number;
  integer?: boolean;
  options?: { value: string; label: string }[];
  optionsFor?: (values: Record<string, string>) => { value: string; label: string }[];
  resetOnChange?: string[];
  emptyLabel?: string;
  placeholder?: string;
  initialValue?: string;
  visibleWhen?: { field: string; value: string };
};
export interface CommandSpec {
  title: string;
  service: Service;
  path: string;
  method?: HttpMethod;
  fields?: Field[];
  version?: number;
  warning?: string;
  warningFor?: (values: Record<string, string>) => string;
  build?: (values: Record<string, string>) => Record<string, unknown> | Promise<Record<string, unknown>>;
}
const sentenceLabel = (value: string) =>
  value.charAt(0).toLocaleLowerCase('vi-VN') + value.slice(1);
function pointValue(value: string) {
  const [longitude, latitude] = value.split(',').map(Number);
  return Number.isFinite(longitude) && Number.isFinite(latitude) && value.includes(',')
    ? { longitude, latitude }
    : null;
}
function requestValuesFor(fields: Field[] | undefined, values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([name, value]) => {
    const type = fields?.find((field) => field.name === name)?.type;
    return [name, type === 'textarea' || type === 'text' || type === undefined
      ? value.trim().normalize('NFC') : value];
  }));
}
function isRequired(field: Field, values: Record<string, string>): boolean {
  return Boolean(field.required || (field.requiredWhen &&
    field.requiredWhen.values.includes(values[field.requiredWhen.field])));
}
function fieldValidationError(field: Field, value: string, values: Record<string, string>): string | undefined {
  const trimmed = value.trim();
  if (field.type === 'location') {
    return isRequired(field, values) && !pointValue(value)
      ? `${field.label} là bắt buộc.`
      : undefined;
  }
  if (isRequired(field, values) && !trimmed)
    return `${field.label} là bắt buộc.`;
  if (!trimmed) return undefined;
  if (field.pattern && !field.pattern.test(trimmed)) return field.patternMessage || `${field.label} chưa hợp lệ.`;
  if (field.type === 'select' && field.optionsFor && !field.optionsFor(values).some((option) => option.value === trimmed))
    return 'Lựa chọn không còn phù hợp. Hãy chọn lại ' + sentenceLabel(field.label) + '.';
  if (field.type === 'reference' &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed))
    return `${field.label} phải là mã hợp lệ.`;
  if (field.minLength !== undefined && trimmed.length < field.minLength)
    return `${field.label} cần ít nhất ${field.minLength} ký tự.`;
  if (field.maxLength !== undefined && value.length > field.maxLength)
    return `${field.label} không được quá ${field.maxLength} ký tự.`;
  if (field.type === 'datetime-local' && field.name === 'occurred_at' && (!Number.isFinite(new Date(trimmed).getTime()) || new Date(trimmed).getTime() > Date.now())) return 'Thời điểm thực tế phải hợp lệ và không nằm trong tương lai.';
  if (field.type === 'number') {
    const number = Number(trimmed);
    const scale = field.scaleFor?.(values);
    if (scale !== undefined && (!/^\d+(?:\.\d+)?$/.test(trimmed) || (trimmed.split('.')[1]?.replace(/0+$/, '').length || 0) > scale)) return scale === 0 ? `${field.label} phải là số nguyên theo đơn vị vật phẩm.` : `${field.label} chỉ được có tối đa ${scale} chữ số thập phân.`;
    const min = field.min ?? (scale === undefined ? 1 : 10 ** -scale);
    if (!Number.isFinite(number)) return `${field.label} phải là số hợp lệ.`;
    if (number < min) return `${field.label} phải từ ${min} trở lên.`;
    const max = field.maxFor?.(values) ?? field.max;
    if (max !== undefined && number > max) return `${field.label} không được vượt quá ${max}.`;
    if ((field.integer || field.name === 'work_cycle') && !Number.isInteger(number))
      return `${field.label} phải là số nguyên.`;
  }
  return undefined;
}
export function CommandForm({
  spec,
  onSuccess,
  onStale,
}: {
  spec: CommandSpec;
  onSuccess: (result?: unknown) => void;
  onStale?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((spec.fields || []).filter((field) => field.initialValue)
      .map((field) => [field.name, field.initialValue!]))
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const [manualFields, setManualFields] = useState<Record<string, boolean>>({});
  const formId = useId();
  const pending = useRef<{ scope: string; key: string; body: Record<string, unknown> } | null>(null);
  const visibleFields = (spec.fields || []).filter(
    (field) => (!field.visibleFor || field.visibleFor(values)) && (!field.visibleWhen || values[field.visibleWhen.field] === field.visibleWhen.value)
  );
  const validationErrors = Object.fromEntries(visibleFields.map((field) => [
    field.name,
    fieldValidationError(field, values[field.name] || '', values),
  ]));
  const hasInvalidFields = visibleFields.some(
    (field) => Boolean(fieldErrors[field.name] || validationErrors[field.name])
  );
  function errorFor(field: Field): string {
    return fieldErrors[field.name] ||
      ((attempted || touched[field.name] || Boolean(values[field.name]))
        ? validationErrors[field.name] || ''
        : '');
  }
  function errorId(field: Field): string {
    return `${formId}-${field.name}-error`;
  }
  function updateField(field: Field, value: string) {
    const resetNames = field.resetOnChange || [];
    setValues((current) => ({
      ...current,
      ...Object.fromEntries(resetNames.map((name) => [name, ''])),
      [field.name]: value,
    }));
    setTouched((current) => ({
      ...current,
      [field.name]: true,
      ...Object.fromEntries(resetNames.map((name) => [name, false])),
    }));
    setFieldErrors((current) => ({
      ...current,
      [field.name]: '',
      ...Object.fromEntries(resetNames.map((name) => [name, ''])),
    }));
    setMessage('');
    pending.current = null;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    if (hasInvalidFields) {
      setMessage('Hãy kiểm tra các trường được đánh dấu.');
      return;
    }
    const warning = spec.warningFor?.(values) ?? spec.warning;
    if (warning && !(await confirmAction(warning))) return;
    setBusy(true);
    setMessage('');
    setFieldErrors({});
    try {
      const scope = `${spec.service}:${spec.method || 'POST'}:${spec.path}:${spec.version ?? ''}`;
      if (pending.current?.scope !== scope) pending.current = null;
      if (!pending.current) {
        const submittedValues = requestValuesFor(spec.fields, values);
        const visibleValues = Object.fromEntries(
          Object.entries(submittedValues).filter(([name, value]) => {
            const field = spec.fields?.find((candidate) => candidate.name === name);
            return value.trim() !== '' &&
              (!field?.visibleFor || field.visibleFor(values)) && (!field?.visibleWhen || submittedValues[field.visibleWhen.field] === field.visibleWhen.value);
          })
        );
        const body = spec.build ? await spec.build(submittedValues) : visibleValues;
        if (spec.version !== undefined) body.expected_version = spec.version;
        pending.current = { scope, key: newCommandKey(), body };
      }
      const result = await api(spec.service, spec.path, {
        method: spec.method || 'POST',
        body: pending.current.body,
        idempotencyKey: pending.current.key,
      });
      pending.current = null;
      setMessage('Thao tác đã được máy chủ xác nhận.');
      onSuccess(result);
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
        pending.current = null;
        onStale?.();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-stack command-form" onSubmit={submit} autoComplete="off" noValidate>
      <h3>{spec.title}</h3>
      {visibleFields.map((field) => {
        const inlineError = errorFor(field);
        const describedBy = inlineError ? errorId(field) : undefined;
        const scale = field.scaleFor?.(values);
        return (
        field.type === 'choice-cards' ? (
          <fieldset key={field.name} className="command-choice-list" aria-invalid={Boolean(inlineError)} aria-describedby={describedBy}>
            <legend>{field.label}{isRequired(field, values) && <> <span className="required-mark" aria-hidden="true">*</span></>}</legend>
            {field.options?.length ? field.options.map((option) => (
              <button
                type="button"
                key={option.value}
                className={`command-choice-card ${values[field.name] === option.value ? 'selected' : ''}`}
                aria-pressed={values[field.name] === option.value}
                onClick={() => {
                  updateField(field, option.value);
                }}
              >
                <span>{option.label}</span>
                <span className="command-choice-indicator" aria-hidden="true">{values[field.name] === option.value ? '✓' : ''}</span>
              </button>
            )) : <p className="empty">Chưa có chiến dịch đang hoạt động phù hợp với khu vực này.</p>}
            {inlineError && <small className="field-error" id={errorId(field)} role="alert">{inlineError}</small>}
          </fieldset>
        ) : field.type === 'reference' ? (
          <div key={field.name} className="form-stack">
            <label htmlFor={`reference-${field.name}`}>
              <span>{field.label}{isRequired(field, values) && <> <span className="required-mark" aria-hidden="true"> *</span></>}</span>
            </label>
            {field.options?.length && !manualFields[field.name] &&
            (!values[field.name] || field.options.some((option) => option.value === values[field.name])) ? (
              <select
                id={`reference-${field.name}`}
                aria-label={field.label}
                required={isRequired(field, values)}
                aria-invalid={Boolean(inlineError)}
                aria-describedby={describedBy}
                value={values[field.name] || ''}
                onBlur={() => setTouched((current) => ({ ...current, [field.name]: true }))}
                onChange={(event) => {
                  if (event.target.value === '__manual__') {
                    setManualFields((current) => ({ ...current, [field.name]: true }));
                    updateField(field, '');
                  } else {
                    updateField(field, event.target.value);
                  }
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
                  aria-label={field.label}
                  required={isRequired(field, values)}
                  minLength={field.minLength}
                  maxLength={field.maxLength !== undefined ? field.maxLength + 1 : undefined}
                  aria-invalid={Boolean(inlineError)}
                  aria-describedby={describedBy}
                  placeholder={field.placeholder || 'Dán mã bản ghi'}
                  value={values[field.name] || ''}
                  onBlur={() => setTouched((current) => ({ ...current, [field.name]: true }))}
                  onChange={(event) => updateField(field, event.target.value)}
                />
                {Boolean(field.options?.length) && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setManualFields((current) => ({ ...current, [field.name]: false }));
                      updateField(field, '');
                    }}
                  >
                    Chọn từ danh sách
                  </button>
                )}
              </>
            )}
            {inlineError && (
              <small className="field-error" id={errorId(field)} role="alert">{inlineError}</small>
            )}
          </div>
        ) : field.type === 'location' ? (
          <div key={field.name} className="form-stack" role="group" aria-invalid={Boolean(inlineError)} aria-describedby={describedBy}>
            <strong>{field.label}{isRequired(field, values) && <> <span className="required-mark" aria-hidden="true">*</span></>}</strong>
            <LocationPicker
              value={pointValue(values[field.name] || '')}
              onSelect={(point) => {
                updateField(field, point ? `${point.longitude},${point.latitude}` : '');
              }}
            />
            {pointValue(values[field.name] || '') && (
              <small>Vị trí đã chọn: {pointValue(values[field.name] || '')?.latitude.toFixed(6)}, {pointValue(values[field.name] || '')?.longitude.toFixed(6)}</small>
            )}
            {inlineError && (
              <small className="field-error" id={errorId(field)} role="alert">{inlineError}</small>
            )}
          </div>
        ) : (
        <label key={field.name}>
          <span>{field.label}{isRequired(field, values) && <> <span className="required-mark" aria-hidden="true"> *</span></>}</span>
          {field.type === 'textarea' ? (
            <textarea
              aria-label={field.label}
              required={isRequired(field, values)}
              minLength={field.minLength}
              maxLength={field.maxLength !== undefined ? field.maxLength + 1 : undefined}
              aria-invalid={Boolean(inlineError)}
              aria-describedby={describedBy}
              placeholder={field.placeholder}
              value={values[field.name] || ''}
              onBlur={() => setTouched((current) => ({ ...current, [field.name]: true }))}
              onChange={(event) => updateField(field, event.target.value)}
            />
          ) : field.type === 'select' ? (
            <select
              aria-label={field.label}
              required={isRequired(field, values)}
              aria-invalid={Boolean(inlineError)}
              aria-describedby={describedBy}
              value={values[field.name] || ''}
              onBlur={() => setTouched((current) => ({ ...current, [field.name]: true }))}
              onChange={(event) => {
                updateField(field, event.target.value);
              }}
            >
              <option value="">{field.emptyLabel || `Chọn ${sentenceLabel(field.label)}`}</option>
              {(field.optionsFor?.(values) || field.options)?.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              aria-label={field.label}
              required={isRequired(field, values)}
              type={field.type || 'text'}
              autoComplete={field.type === 'password' ? 'new-password' : 'off'}
              min={field.type === 'number' ? (field.min ?? (scale === undefined ? 1 : 10 ** -scale)) : undefined}
              max={field.type === 'number' ? (field.maxFor?.(values) ?? field.max) : undefined}
              step={
                field.type === 'number'
                  ? field.integer || field.name === 'work_cycle'
                    ? '1'
                    : scale === undefined ? 'any' : 10 ** -scale
                  : undefined
              }
              minLength={field.minLength}
              maxLength={field.maxLength !== undefined ? field.maxLength + 1 : undefined}
              aria-invalid={Boolean(inlineError)}
              aria-describedby={describedBy}
              placeholder={field.placeholder}
              value={values[field.name] || ''}
              onBlur={() => setTouched((current) => ({ ...current, [field.name]: true }))}
              onChange={(event) => updateField(field, event.target.value)}
            />
          )}
          {inlineError && (
            <small className="field-error" id={errorId(field)} role="alert">{inlineError}</small>
          )}
        </label>
        )
        );
      })}
      {message && (
        <p
          role={message.startsWith('Thao tác đã') ? 'status' : 'alert'}
          className={message.startsWith('Thao tác đã') ? 'notice' : 'notice error'}
        >
          {message}
        </p>
      )}
      <button className="button" disabled={busy || hasInvalidFields}>
        {busy ? 'Đang xử lý…' : spec.title}
      </button>
    </form>
  );
}
