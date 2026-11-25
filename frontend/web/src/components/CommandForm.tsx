import { Dropdown } from './ui/Dropdown';
import { useId, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, newCommandKey, upload, type Service, type HttpMethod } from '../api/client';
import { evidenceFileError } from '../i18n/evidence';
import { SelectedFiles } from './ui/SelectedFiles';
import { LocationPicker, type LocationOverlay } from '../maps/LocationPicker';
import { CampaignAreaMap } from '../maps/CampaignAreaMap';
import { confirmAction } from './confirmAction';

export type Field = {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'password' | 'textarea' | 'select' | 'choice-cards' | 'datetime-local' | 'location' | 'service-area' | 'reference' | 'checkbox';
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
  searchable?: boolean;
  optionsFor?: (values: Record<string, string>) => { value: string; label: string }[];
  resetOnChange?: string[];
  emptyLabel?: string;
  placeholder?: string;
  initialValue?: string;
  /** Value used when the field is empty and this returns one (e.g. after a related field changes). */
  defaultFor?: (values: Record<string, string>) => string | undefined;
  /** Inline note shown under the field, derived from the current form values. */
  hintFor?: (values: Record<string, string>) => string | undefined;
  visibleWhen?: { field: string; value: string };
  /** For `location` fields: area drawn on the map from the other form values. */
  overlayFor?: (values: Record<string, string>) => LocationOverlay | undefined;
  /** For `service-area` fields: the paired radius field (metres) that the map circle edits together with the centre. */
  radiusFieldName?: string;
  /** For `service-area` fields: fill the paired address note from a selected search result. */
  addressFieldName?: string;
  /** For `service-area` fields: allowed radius for the map handles (metres). */
  radiusRange?: { min: number; max: number };
};
export interface CommandSpec {
  title: string;
  service: Service;
  path: string;
  method?: HttpMethod;
  fields?: Field[];
  version?: number;
  warning?: string;
  /** Hide the heading when the surrounding UI already names the action. */
  hideTitle?: boolean;
  /** Visual weight of the submit button; destructive or secondary actions should not look like the main step. */
  tone?: 'primary' | 'secondary' | 'danger';
  warningFor?: (values: Record<string, string>) => string;
  /** When set, the form offers optional photo/video files uploaded here before the command is sent. */
  uploadPath?: string;
  uploadLabel?: string;
  build?: (values: Record<string, string>, uploadedEvidenceIds: string[]) => Record<string, unknown> | Promise<Record<string, unknown>>;
}
const sentenceLabel = (value: string) =>
  value.charAt(0).toLocaleLowerCase('vi-VN') + value.slice(1);
function pointValue(value: string) {
  const [longitude, latitude] = value.split(',').map(Number);
  return Number.isFinite(longitude) && Number.isFinite(latitude) && value.includes(',')
    ? { longitude, latitude }
    : null;
}
/** Fills empty fields that declare a `defaultFor` value. */
function withFieldDefaults(fields: Field[] | undefined, values: Record<string, string>): Record<string, string> {
  let next = values;
  for (const field of fields || []) {
    if (!field.defaultFor || next[field.name]) continue;
    const value = field.defaultFor(next);
    if (value) next = { ...next, [field.name]: value };
  }
  return next;
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
  if (field.type === 'service-area') {
    const radius = field.radiusFieldName ? (values[field.radiusFieldName] || '').trim() : '';
    if (pointValue(value) && !radius) return 'Vui lòng nhập bán kính phục vụ.';
    if (!pointValue(value) && radius) return 'Vui lòng chọn tâm vùng trên bản đồ, hoặc xóa bán kính.';
    return undefined;
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
  const [values, setValues] = useState<Record<string, string>>(() => withFieldDefaults(spec.fields,
    Object.fromEntries((spec.fields || []).filter((field) => field.initialValue)
      .map((field) => [field.name, field.initialValue!]))
  ));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const [manualFields, setManualFields] = useState<Record<string, boolean>>({});
  const [choiceSearch, setChoiceSearch] = useState<Record<string, string>>({});
  const [expandedChoices, setExpandedChoices] = useState<Record<string, boolean>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState('');
  const uploaded = useRef<{ file: File; key: string; id?: string }[]>([]);
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
    setValues((current) => withFieldDefaults(spec.fields, {
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
  /** Writes a service-area centre and its paired radius in one update, so the two never disagree. */
  function updateServiceArea(field: Field, center: { longitude: number; latitude: number } | null, radiusM: number | null, address?: string) {
    const radiusName = field.radiusFieldName;
    setValues((current) => {
      const previousCenter = pointValue(current[field.name] || '');
      const sameCenter = Boolean(center && previousCenter
        && Math.abs(center.longitude - previousCenter.longitude) < 0.000001
        && Math.abs(center.latitude - previousCenter.latitude) < 0.000001);
      let addressValue = '';
      if (center && field.addressFieldName) {
        if (address !== undefined) addressValue = address.slice(0, 500);
        else if (sameCenter) addressValue = current[field.addressFieldName] || '';
        else addressValue = '';
      }
      return {
        ...current,
        [field.name]: center ? `${center.longitude},${center.latitude}` : '',
        ...(radiusName ? { [radiusName]: center && radiusM ? String(Math.round(radiusM)) : '' } : {}),
        ...(field.addressFieldName ? {
          [field.addressFieldName]: addressValue,
        } : {}),
      };
    });
    setTouched((current) => ({ ...current, [field.name]: true, ...(radiusName ? { [radiusName]: true } : {}) }));
    setFieldErrors((current) => ({ ...current, [field.name]: '', ...(radiusName ? { [radiusName]: '' } : {}) }));
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
        if (spec.uploadPath && files.length) {
          if (uploaded.current.length !== files.length || uploaded.current.some((entry, index) => entry.file !== files[index]))
            uploaded.current = files.map((file) => ({ file, key: newCommandKey() }));
          for (const entry of uploaded.current) {
            if (entry.id) continue;
            const result = await upload<{ id: string }>(spec.service, spec.uploadPath, entry.file, { idempotencyKey: entry.key });
            entry.id = result.id;
          }
        }
        const evidenceIds = uploaded.current.flatMap((entry) => entry.id ? [entry.id] : []);
        const body = spec.build ? await spec.build(submittedValues, evidenceIds) : visibleValues;
        if (spec.version !== undefined) body.expected_version = spec.version;
        pending.current = { scope, key: newCommandKey(), body };
      }
      const result = await api(spec.service, spec.path, {
        method: spec.method || 'POST',
        body: pending.current.body,
        idempotencyKey: pending.current.key,
      });
      pending.current = null;
      uploaded.current = [];
      setFiles([]);
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
            errors[field.name] = `Vui lòng kiểm tra ${sentenceLabel(field.label)}.`;
        }
        setFieldErrors(errors);
      }
      if (
        cause instanceof ApiError &&
        ['VERSION_CONFLICT', 'STATE_TRANSITION_INVALID', 'SUPPLY_GAP_NOT_OPEN'].includes(cause.code)
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
      {!spec.hideTitle && <h3>{spec.title}</h3>}
      {visibleFields.map((field) => {
        const inlineError = errorFor(field);
        const describedBy = inlineError ? errorId(field) : undefined;
        const scale = field.scaleFor?.(values);
        const search = (choiceSearch[field.name] ?? '').trim().toLocaleLowerCase('vi-VN');
        const matchingChoices = field.options?.filter((option) => option.label.toLocaleLowerCase('vi-VN').includes(search)) ?? [];
        const shownChoices = field.searchable && !search && !expandedChoices[field.name]
          ? matchingChoices.filter((option, index) => index < 5 || option.value === values[field.name]) : matchingChoices;
        return (
        field.type === 'choice-cards' ? (
          <fieldset key={field.name} className={`command-choice-list command-choice-list--${field.name}${expandedChoices[field.name] || search ? ' command-choice-list--scroll' : ''}`} aria-invalid={Boolean(inlineError)} aria-describedby={describedBy}>
            <legend>{field.label}{isRequired(field, values) && <> <span className="required-mark" aria-hidden="true">*</span></>}</legend>
            {field.searchable && (field.options?.length ?? 0) > 5 && <>
              <label className="command-choice-search" htmlFor={`${formId}-${field.name}-search`}>Tìm {sentenceLabel(field.label)}</label>
              <input id={`${formId}-${field.name}-search`} type="search" value={choiceSearch[field.name] ?? ''}
                placeholder={`Nhập tên ${sentenceLabel(field.label)}…`}
                onChange={(event) => setChoiceSearch((current) => ({ ...current, [field.name]: event.target.value }))} />
              {!search && !expandedChoices[field.name] && <small className="muted">Hiển thị 5 lựa chọn đầu. Tìm theo tên để chọn mục khác.</small>}
            </>}
            {field.options?.length ? shownChoices.map((option) => (
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
            )) : <p className="empty">Chưa có lựa chọn phù hợp.</p>}
            {field.options?.length && !shownChoices.length && <p className="empty">Không tìm thấy mục phù hợp.</p>}
            {field.searchable && !search && matchingChoices.length > shownChoices.length &&
              <button type="button" className="button secondary command-choice-more"
                onClick={() => setExpandedChoices((current) => ({ ...current, [field.name]: true }))}>
                Xem tất cả {matchingChoices.length} lựa chọn
              </button>}
            {inlineError && <small className="field-error" id={errorId(field)} role="alert">{inlineError}</small>}
          </fieldset>
        ) : field.type === 'reference' ? (
          <div key={field.name} className="form-stack">
            <label htmlFor={`reference-${field.name}`}>
              <span>{field.label}{isRequired(field, values) && <> <span className="required-mark" aria-hidden="true"> *</span></>}</span>
            </label>
            {field.options?.length && !manualFields[field.name] &&
            (!values[field.name] || field.options.some((option) => option.value === values[field.name])) ? (
              <Dropdown
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
              </Dropdown>
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
            {field.hintFor?.(values) && <small className="field-hint" role="note">{field.hintFor(values)}</small>}
            {inlineError && (
              <small className="field-error" id={errorId(field)} role="alert">{inlineError}</small>
            )}
          </div>
        ) : field.type === 'service-area' ? (() => {
          const centre = pointValue(values[field.name] || '');
          const radiusValue = Number(field.radiusFieldName ? values[field.radiusFieldName] : '');
          const radiusRange = field.radiusRange ?? { min: 500, max: 300_000 };
          return (
          <div key={field.name} className="form-stack service-area-field" role="group" aria-invalid={Boolean(inlineError)} aria-describedby={describedBy}>
            <strong>{field.label}</strong>
            <small className="muted">Chạm bản đồ để chọn tâm vùng. Kéo ghim để đổi tâm và kéo tay nắm trên vòng tròn để chỉnh bán kính. Địa chỉ gần đúng được điền vào ô bên dưới và có thể chỉnh lại.</small>
            <LocationPicker
              value={centre}
              onAddressResolved={(point, address) => {
                if (!field.addressFieldName) return;
                const selectedCenter = pointValue(values[field.name] || '');
                if (!selectedCenter
                  || Math.abs(selectedCenter.longitude - point.longitude) >= 0.000001
                  || Math.abs(selectedCenter.latitude - point.latitude) >= 0.000001) return;
                const coordinateNote = `Tọa độ: ${selectedCenter.latitude.toFixed(6)}, ${selectedCenter.longitude.toFixed(6)}`;
                const currentAddress = values[field.addressFieldName] || '';
                if (currentAddress && currentAddress !== coordinateNote) return;
                const currentRadius = Number(field.radiusFieldName ? values[field.radiusFieldName] : '');
                updateServiceArea(field, selectedCenter, Number.isFinite(currentRadius) && currentRadius > 0 ? currentRadius : 5_000, address);
              }}
              selectOnPick
              closeOnSelect
              hideMap
              hideToggle
              onSelect={(point, address) => updateServiceArea(field, point, point ? (radiusValue > 0 ? radiusValue : 5_000) : null, address)}
            />
            <CampaignAreaMap
              requests={[]}
              campaigns={[]}
              ariaLabel={`${field.label}: chọn tâm và bán kính trên bản đồ`}
              editor={{
                center: centre ? { lat: centre.latitude, lng: centre.longitude } : null,
                radiusM: Number.isFinite(radiusValue) && radiusValue > 0 ? radiusValue : 5_000,
                radiusRange,
                onChange: (nextCenter, nextRadius) => updateServiceArea(field, { longitude: nextCenter.lng, latitude: nextCenter.lat }, nextRadius),
              }}
            />
            {centre && <div>
              <button type="button" className="button secondary" disabled={!centre && !values[field.radiusFieldName || '']}
                onClick={() => updateServiceArea(field, null, null)}>Xóa vùng phục vụ</button>
            </div>}
            {inlineError && (
              <small className="field-error" id={errorId(field)} role="alert">{inlineError}</small>
            )}
          </div>
          );
        })() : field.type === 'location' ? (
          <div key={field.name} className="form-stack" role="group" aria-invalid={Boolean(inlineError)} aria-describedby={describedBy}>
            <strong>{field.label}{isRequired(field, values) && <> <span className="required-mark" aria-hidden="true">*</span></>}</strong>
            <LocationPicker
              value={pointValue(values[field.name] || '')}
              overlay={field.overlayFor?.(values)}
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
        ) : field.type === 'checkbox' ? (
          <label key={field.name} className="command-checkbox">
            <input
              type="checkbox"
              checked={values[field.name] === 'true'}
              onChange={(event) => updateField(field, event.target.checked ? 'true' : 'false')}
            />
            <span>{field.label}</span>
            {field.hintFor?.(values) && <small className="field-hint" role="note">{field.hintFor(values)}</small>}
          </label>
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
            <Dropdown
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
            </Dropdown>
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
          {field.hintFor?.(values) && <small className="field-hint" role="note">{field.hintFor(values)}</small>}
          {inlineError && (
            <small className="field-error" id={errorId(field)} role="alert">{inlineError}</small>
          )}
        </label>
        )
        );
      })}
      {spec.uploadPath && (
        <div className="command-upload-field"><label>
          <span>{spec.uploadLabel || 'Ảnh hoặc video đối chiếu (không bắt buộc, tối đa 5 tệp)'}</span>
          <input type="file" multiple accept="image/jpeg,image/png,video/mp4"
            onChange={(event) => {
              const chosen = Array.from(event.target.files ?? []).slice(0, 5);
              const problem = chosen.map(evidenceFileError).find(Boolean) ?? '';
              setFileError(problem || ((event.target.files?.length ?? 0) > 5 ? 'Chỉ nhận tối đa 5 tệp; các tệp thừa đã bị bỏ qua.' : ''));
              setFiles(problem ? [] : chosen);
              event.target.value = '';
              pending.current = null;
            }} />
          </label>
          <SelectedFiles files={files} onRemove={(index) => { setFiles((current) => current.filter((_, position) => position !== index)); setFileError(''); pending.current = null; }} />
          {fileError && <small className="field-error" role="alert">{fileError}</small>}
        </div>
      )}
      {message && (
        <p
          role={message.startsWith('Thao tác đã') ? 'status' : 'alert'}
          className={message.startsWith('Thao tác đã') ? 'notice' : 'notice error'}
        >
          {message}
        </p>
      )}
      <button className={`button${spec.tone === 'secondary' ? ' secondary' : spec.tone === 'danger' ? ' secondary command-danger' : ''}`} disabled={busy || hasInvalidFields}>
        {busy ? 'Đang xử lý…' : spec.title}
      </button>
    </form>
  );
}
