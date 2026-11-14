import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, newCommandKey } from '../../api/client';
import type { Me } from '../../auth/session';
import { me } from '../../auth/session';
import type { components as ResponseComponents } from '../../api/generated/response';
import { requestStatusLabel, timeLabel } from '../../i18n/labels';
import { LocationPicker } from '../../maps/LocationPicker';
import { SosWeatherAlerts } from './SosWeatherAlerts';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { clearSosDraft, readSosDraft, writeSosDraft, type SosDraft } from './sosDraft';

// Versioned demo catalog: docs/backend/seed/seed-response.sql (2026-10-18).
// Replace with a public category contract before non-demo deployment.
const categories = [
  ['FLOOD', 'Ngập lụt'],
  ['LANDSLIDE', 'Sạt lở đất'],
  ['STORM', 'Bão, gió lốc'],
  ['FIRE', 'Cháy'],
  ['MEDICAL', 'Cấp cứu y tế'],
  ['TRAPPED', 'Người bị mắc kẹt'],
  ['SUPPLY_SHORTAGE', 'Thiếu lương thực, nhu yếu phẩm'],
  ['OTHER', 'Khác'],
  ['UNKNOWN', 'Chưa rõ'],
] as const;
type Created = ResponseComponents['schemas']['CreatedSelfRequest'];
type Pending = {
  key: string;
  secret: string;
  body: Record<string, unknown>;
  path: string;
};
function secret32(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function SosForm({
  user,
  onConfirmed,
  onTrack,
}: {
  user: Me | null;
  onConfirmed?: (receipt: Created) => void;
  onTrack?: (code: string) => void;
}) {
  const [copyMessage, setCopyMessage] = useState('');
  async function copyReceipt(value: string) {
    try { await navigator.clipboard.writeText(value); setCopyMessage('Đã sao chép. Hãy lưu ở nơi riêng tư.'); }
    catch { setCopyMessage('Không sao chép được. Hãy chọn và sao chép mã bằng tay.'); }
  }
  const [initialDraft] = useState(() => readSosDraft(user?.id));
  const [restored, setRestored] = useState(Boolean(initialDraft));
  const [mode, setMode] = useState<'SELF' | 'PROXY'>(initialDraft?.mode ?? 'SELF');
  const [category, setCategory] = useState(initialDraft?.category ?? '');
  const [description, setDescription] = useState(initialDraft?.description ?? '');
  const [people, setPeople] = useState(initialDraft?.people ?? '');
  const [children, setChildren] = useState(initialDraft?.children ?? '');
  const [elderly, setElderly] = useState(initialDraft?.elderly ?? '');
  const [name, setName] = useState(initialDraft?.name ?? '');
  const [phone, setPhone] = useState(initialDraft?.phone ?? '');
  const [beneficiaryPhone, setBeneficiaryPhone] = useState(initialDraft?.beneficiaryPhone ?? '');
  const [alternateName, setAlternateName] = useState(initialDraft?.alternateName ?? '');
  const [alternatePhone, setAlternatePhone] = useState(initialDraft?.alternatePhone ?? '');
  const [proxyContactsOpen, setProxyContactsOpen] = useState(Boolean(
    initialDraft?.beneficiaryPhone || initialDraft?.alternateName || initialDraft?.alternatePhone
  ));
  const [danger, setDanger] = useState(initialDraft?.danger ?? false);
  const [needsRescue, setNeedsRescue] = useState(initialDraft?.needsRescue ?? true);
  const [needsRelief, setNeedsRelief] = useState(initialDraft?.needsRelief ?? false);
  const [longitude, setLongitude] = useState(initialDraft?.longitude ?? '');
  const [latitude, setLatitude] = useState(initialDraft?.latitude ?? '');
  const [source, setSource] = useState<'MANUAL_PIN' | 'GPS'>('MANUAL_PIN');
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [relationship, setRelationship] = useState(initialDraft?.relationship ?? '');
  const [informationSource, setInformationSource] = useState(initialDraft?.informationSource ?? '');
  const [situationAt, setSituationAt] = useState(initialDraft?.situationAt ?? '');
  const [contactability, setContactability] = useState(initialDraft?.contactability ?? 'UNKNOWN');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [networkError, setNetworkError] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [ackSecret, setAckSecret] = useState('');
  const pending = useRef<Pending | null>(null);
  const locationAttempt = useRef(0);
  useEffect(() => () => { locationAttempt.current += 1; }, []);

  useEffect(() => {
    if (created) return;
    const draft: SosDraft = {
      mode, category, description, people, children, elderly, name, phone,
      beneficiaryPhone, alternateName, alternatePhone, danger, needsRescue, needsRelief,
      longitude, latitude, relationship, informationSource, situationAt, contactability,
    };
    const hasInput = Object.entries(draft).some(([field, value]) =>
      !['mode', 'danger', 'needsRescue', 'needsRelief', 'contactability'].includes(field) && Boolean(value)) ||
      mode === 'PROXY' || danger || !needsRescue || needsRelief || contactability !== 'UNKNOWN';
    if (hasInput) writeSosDraft(user?.id, draft);
    else clearSosDraft(user?.id);
  }, [user?.id, created, mode, category, description, people, children, elderly, name, phone,
    beneficiaryPhone, alternateName, alternatePhone, danger, needsRescue, needsRelief,
    longitude, latitude, relationship, informationSource, situationAt, contactability]);

  function discardDraft() {
    locationAttempt.current += 1;
    clearSosDraft(user?.id);
    setRestored(false);
    setMode('SELF'); setCategory(''); setDescription(''); setPeople(''); setChildren('');
    setElderly(''); setName(''); setPhone(''); setBeneficiaryPhone('');
    setAlternateName(''); setAlternatePhone(''); setDanger(false); setNeedsRescue(true);
    setNeedsRelief(false); setLongitude(''); setLatitude(''); setSource('MANUAL_PIN');
    setAccuracy(null); setCaptured(null); setRelationship(''); setInformationSource('');
    setSituationAt(''); setContactability('UNKNOWN'); setProxyContactsOpen(false);
    setError(''); setFieldError(null); setTouched({}); setAttempted(false);
    pending.current = null;
  }

  function locate() {
    const attempt = ++locationAttempt.current;
    if (!navigator.geolocation) {
      setError('Trình duyệt không hỗ trợ xác định vị trí. Hãy chọn vị trí cần hỗ trợ trên bản đồ.');
      return;
    }
    setError('');
    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) => {
        if (attempt !== locationAttempt.current) return;
        setTouched((current) => ({ ...current, location: true }));
        setLongitude(String(coords.longitude));
        setLatitude(String(coords.latitude));
        setAccuracy(coords.accuracy);
        setCaptured(new Date(timestamp).toISOString());
        setSource('GPS');
        setFieldError(null);
        setError('');
        setNetworkError(false);
        pending.current = null;
      },
      () => { if (attempt === locationAttempt.current) setError('Không thể lấy vị trí. Hãy chọn vị trí cần hỗ trợ trên bản đồ.'); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }
  function chooseMapPoint(point: { longitude: number; latitude: number } | null) {
    locationAttempt.current += 1;
    setTouched((current) => ({ ...current, location: true }));
    setLongitude(point ? String(point.longitude) : '');
    setLatitude(point ? String(point.latitude) : '');
    setSource('MANUAL_PIN');
    setAccuracy(null);
    setCaptured(null);
    setFieldError(null);
    setError('');
    setNetworkError(false);
    pending.current = null;
  }
  function getClientErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    if (!category) errors.category = 'Loại sự cố là bắt buộc.';
    if (description.length > 2000) errors.description = 'Mô tả không được vượt quá 2.000 ký tự.';
    if (name.length > 200) errors.name = 'Họ tên người báo không được vượt quá 200 ký tự.';
    for (const [field, value] of [['phone', phone], ['beneficiaryPhone', beneficiaryPhone], ['alternatePhone', alternatePhone]] as const) {
      if (!value.trim()) continue;
      const normalizedPhone = value.trim().replace(/[ ()-]/g, '');
      if (value.length > 32)
        errors[field] = 'Số điện thoại không được vượt quá 32 ký tự.';
      else if (!/^\+?[0-9]{8,15}$/.test(normalizedPhone))
        errors[field] = 'Số điện thoại cần có 8–15 chữ số; có thể thêm dấu + ở đầu.';
    }
    const lon = Number(longitude), lat = Number(latitude);
    if (!longitude || !latitude) errors.location = 'Vị trí cần hỗ trợ là bắt buộc.';
    else if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90)
      errors.location = 'Vị trí cần hỗ trợ không hợp lệ.';
    if (people && (!Number.isInteger(Number(people)) || Number(people) < 1 || Number(people) > 10000))
      errors.people = 'Số người cần hỗ trợ phải từ 1 đến 10.000.';
    if (children && (!Number.isInteger(Number(children)) || Number(children) < 0 || Number(children) > 10000))
      errors.children = 'Số trẻ em phải từ 0 đến 10.000.';
    if (elderly && (!Number.isInteger(Number(elderly)) || Number(elderly) < 0 || Number(elderly) > 10000))
      errors.elderly = 'Số người cao tuổi phải từ 0 đến 10.000.';
    if (people && Number(children || 0) + Number(elderly || 0) > Number(people))
      errors.people = 'Tổng số trẻ em và người cao tuổi không được lớn hơn tổng số người.';
    if (!needsRescue && !needsRelief) errors.needs = 'Nhu cầu cần hỗ trợ là bắt buộc.';
    if (mode === 'PROXY') {
      if (!user) errors.mode = 'Vui lòng đăng nhập để báo hộ.';
      if (!relationship.trim()) errors.relationship = 'Quan hệ với gia đình cần hỗ trợ là bắt buộc.';
      else if (relationship.length > 100) errors.relationship = 'Quan hệ không được vượt quá 100 ký tự.';
      if (!informationSource.trim()) errors.informationSource = 'Nguồn thông tin là bắt buộc.';
      else if (informationSource.length > 500) errors.informationSource = 'Nguồn thông tin không được vượt quá 500 ký tự.';
      if (!situationAt) errors.situationAt = 'Thời điểm biết tình hình là bắt buộc.';
      else if (!Number.isFinite(new Date(situationAt).getTime()))
        errors.situationAt = 'Thời điểm biết tình hình không hợp lệ.';
      else if (new Date(situationAt).getTime() > Date.now())
        errors.situationAt = 'Thời điểm biết tình hình không được ở trong tương lai.';
      if (alternateName.length > 200) errors.alternateName = 'Tên người liên hệ thay thế không được vượt quá 200 ký tự.';
      if (alternatePhone.trim() && !alternateName.trim()) errors.alternateName = 'Tên người liên hệ thay thế là bắt buộc.';
    }
    return errors;
  }
  const clientErrors = getClientErrors();
  function build(): Pending {
    const invalid = (field: string, message: string): never => {
      throw Object.assign(new Error(message), { field });
    };
    const lon = Number(longitude),
      lat = Number(latitude);
    const errors = getClientErrors();
    const firstError = Object.entries(errors)[0];
    if (firstError) invalid(firstError[0], firstError[1]);
    const location = {
      type: 'Point',
      coordinates: [lon, lat],
      source,
      ...(source === 'GPS' ? { accuracy_m: accuracy, captured_at: captured } : {}),
    };
    const body: Record<string, unknown> = {
      incident_category_code: category,
      location,
      reporter_declared_danger: danger,
      needs_rescue: needsRescue,
      needs_relief_supplies: needsRelief,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(people ? { people_affected: Number(people) } : {}),
      ...(children ? { children_count: Number(children) } : {}),
      ...(elderly ? { elderly_count: Number(elderly) } : {}),
      ...(name.trim() ? { reporter_name: name.trim() } : {}),
      ...(phone.trim() ? { reporter_contact_phone: phone.trim() } : {}),
    };
    if (mode === 'PROXY')
      Object.assign(body, {
        relationship: relationship.trim(),
        information_source: informationSource.trim(),
        last_known_situation_at: new Date(situationAt).toISOString(),
        contactability,
        ...(beneficiaryPhone.trim() ? { beneficiary_contact_phone: beneficiaryPhone.trim() } : {}),
        ...(alternateName.trim() ? { alternate_contact: {
          name: alternateName.trim(),
          ...(alternatePhone.trim() ? { phone: alternatePhone.trim() } : {}),
        } } : {}),
      });
    return {
      key: newCommandKey(),
      secret: mode === 'SELF' && !user ? secret32() : '',
      body,
      path: mode === 'PROXY' ? '/requests/proxy' : '/requests',
    };
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    setError('');
    setNetworkError(false);
    setFieldError(null);
    const errors = getClientErrors();
    if (Object.keys(errors).length) {
      const [field, message] = Object.entries(errors)[0];
      if (['beneficiaryPhone', 'alternateName', 'alternatePhone'].includes(field)) setProxyContactsOpen(true);
      setFieldError({ field, message });
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-sos-field="${field}"]`)?.focus());
      return;
    }
    setBusy(true);
    try {
      const command = pending.current || build();
      pending.current = command;
      // A web session can expire while the citizen is filling in the form.
      // Response otherwise sees an anonymous SELF request without a guest secret
      // and returns TRACKING_SECRET_INVALID, which obscures the real problem.
      if (user) {
        const activeUser = await me();
        if (activeUser.id !== user.id) {
          throw new Error('Tài khoản đăng nhập đã thay đổi. Vui lòng tải lại trang và kiểm tra yêu cầu trước khi gửi.');
        }
      }
      const result = await api<Created>('response', command.path, {
        method: 'POST',
        body: command.body,
        idempotencyKey: command.key,
        headers: command.secret ? { 'X-Tracking-Secret': command.secret } : {},
      });
      clearSosDraft(user?.id);
      setAckSecret(command.secret);
      setCreated(result);
      onConfirmed?.(result);
      pending.current = null;
    } catch (cause) {
      if (cause instanceof Error && 'field' in cause && typeof cause.field === 'string') {
        if (['beneficiaryPhone', 'alternateName', 'alternatePhone'].includes(cause.field)) setProxyContactsOpen(true);
        setFieldError({ field: cause.field, message: cause.message });
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-sos-field="${cause.field}"]`)?.focus());
      } else {
        setNetworkError(cause instanceof ApiError && cause.code === 'NETWORK_UNAVAILABLE');
        setError(cause instanceof ApiError && cause.code === 'TRACKING_SECRET_INVALID'
          ? user
            ? 'Phiên đăng nhập có thể đã hết hạn. Vui lòng đăng nhập lại rồi gửi yêu cầu.'
            : 'Mã bảo mật gửi SOS chưa hợp lệ. Vui lòng tải lại trang rồi gửi lại.'
          : cause instanceof Error ? cause.message : 'Chưa gửi được yêu cầu. Vui lòng thử lại.');
      }
    } finally {
      setBusy(false);
    }
  }
  const fieldMessage = (field: string) => {
    const message = fieldError?.field === field ? fieldError.message : clientErrors[field];
    return message && (attempted || touched[field])
      ? <span className="sos-field-error" role="alert">{message}</span>
      : null;
  };
  const fieldInvalid = (field: string) =>
    fieldError?.field === field || Boolean((attempted || touched[field]) && clientErrors[field]);
  if (created)
    return (
      <section className="card confirmation sos-confirmation" role="status">
        <div className="sos-confirmation-heading"><span className="sos-confirmation-icon" aria-hidden="true">✓</span><div><span className="eyebrow">Đã gửi thành công</span><h2>Yêu cầu đã được tiếp nhận</h2></div></div>
        <div className="sos-tracking-receipt"><div><span>Mã theo dõi</span><strong>{created.tracking_code}</strong></div><button type="button" className="button secondary" onClick={() => copyReceipt(created.tracking_code)}>Sao chép mã</button></div>
        <p className="sos-confirmation-meta"><span>Trạng thái: <strong>{requestStatusLabel(created.status)}</strong></span><span>Tiếp nhận lúc {timeLabel(created.received_at)}</span></p>
        {ackSecret && (
          <div className="notice warning">
            <strong>Lưu mã bảo mật này ngay:</strong>
            <div className="secret">{ackSecret}</div>
            <button type="button" className="button secondary" onClick={() => copyReceipt(ackSecret)}>Sao chép mã bảo mật</button>
            <p>
              Mã chỉ hiển thị trong lần này. Hãy giữ riêng tư để tra cứu và bổ sung thông tin. Ứng
              dụng không lưu mã trên trình duyệt.
            </p>
          </div>
        )}
        <p>
          Điều phối viên sẽ xác minh và quyết định ưu tiên. Nếu đang nguy hiểm, hãy gọi 113, 114
          hoặc 115.
        </p>
        {copyMessage && <p role="status">{copyMessage}</p>}
        {user && onTrack && (
          <button type="button" className="button" onClick={() => onTrack(created.tracking_code)}>
            Theo dõi tiến độ
          </button>
        )}
      </section>
    );
  return (
    <form className="form-stack sos-form" onSubmit={submit} onBlurCapture={(event) => {
      const field = (event.target as HTMLElement).dataset.sosField;
      if (field) setTouched((current) => ({ ...current, [field]: true }));
    }} onChange={(event) => {
      const field = (event.target as HTMLElement).dataset.sosField;
      if (field) setTouched((current) => ({ ...current, [field]: true }));
      setFieldError(null);
      setError('');
      setNetworkError(false);
      pending.current = null;
    }} noValidate>
      {restored && <div className="notice warning" role="status">
        <strong>Đã khôi phục bản nháp chưa gửi.</strong> Kiểm tra lại tình huống và vị trí trước khi gửi.
        <button type="button" className="button secondary" onClick={discardDraft}>Bỏ bản nháp</button>
      </div>}
      <div className="sos-layout">
        <div className="sos-col-map">
          <Card className="sos-location-card" aria-labelledby="sos-location-title">
            <div className="location-heading" id="sos-location">
              <h2 id="sos-location-title"><span className="sos-step-number" aria-hidden="true">1</span>Vị trí cần hỗ trợ <span className="required-mark" aria-hidden="true">*</span></h2>
              {mode === 'SELF' && <Button type="button" variant="secondary" onClick={locate}>
                Dùng vị trí hiện tại
              </Button>}
            </div>
            {fieldMessage('location')}
            <LocationPicker
              initiallyOpen
              value={longitude && latitude ? { longitude: Number(longitude), latitude: Number(latitude) } : null}
              onSelect={chooseMapPoint}
            />
            {longitude && latitude && <p className="sos-selected-coordinates">Vị trí đã chọn: {Number(latitude).toFixed(5)}, {Number(longitude).toFixed(5)}</p>}
            <SosWeatherAlerts point={longitude && latitude && Number.isFinite(Number(longitude)) && Number.isFinite(Number(latitude))
              ? { longitude: Number(longitude), latitude: Number(latitude) } : null} />
          </Card>
        </div>
        <div className="sos-col-form">
          <Card className="sos-step-card" aria-labelledby="sos-situation-title">
            <h2 id="sos-situation-title"><span className="sos-step-number" aria-hidden="true">2</span>Tình huống</h2>
            {user && (
              <fieldset>
                <legend>Yêu cầu này là</legend>
                <label className="radio">
                  <input
                    type="radio"
                    checked={mode === 'SELF'}
                    onChange={() => {
                      setMode('SELF');
                      pending.current = null;
                    }}
                  />{' '}
                  Cho chính tôi (tôi đang ở nơi cần cứu nạn)
                </label>
                <label className="radio">
                  <input
                    type="radio"
                    checked={mode === 'PROXY'}
                    onChange={() => {
                      setMode('PROXY');
                      locationAttempt.current += 1;
                      if (source === 'GPS') {
                        setLongitude(''); setLatitude(''); setAccuracy(null); setCaptured(null); setSource('MANUAL_PIN');
                      }
                      pending.current = null;
                    }}
                  />{' '}
                  Cho người thân (tôi không ở đó)
                </label>
              </fieldset>
            )}
              <label>
                <span>Loại sự cố <span className="required-mark" aria-hidden="true">*</span></span>
                <select
                  data-sos-field="category"
                  aria-invalid={fieldInvalid('category')}
                  required
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    pending.current = null;
                  }}
                >
                  <option value="">Chọn loại sự cố</option>
                  {categories.map(([code, title]) => (
                    <option key={code} value={code}>
                      {title}
                    </option>
                  ))}
                </select>
                {fieldMessage('category')}
              </label>
            <fieldset className="sos-needs" aria-invalid={fieldInvalid('needs')}>
              <legend>Nhu cầu cần hỗ trợ <span className="required-mark" aria-hidden="true">*</span></legend>
              <label className="radio">
                <input
                  type="checkbox"
                  data-sos-field="needs"
                  checked={needsRescue}
                  onChange={(e) => {
                    setNeedsRescue(e.target.checked);
                    pending.current = null;
                  }}
                />{' '}
                Cần đội đến cứu hộ tại hiện trường
              </label>
              <label className="radio">
                <input
                  type="checkbox"
                  data-sos-field="needs"
                  checked={needsRelief}
                  onChange={(e) => {
                    setNeedsRelief(e.target.checked);
                    pending.current = null;
                  }}
                />{' '}
                Cần hàng cứu trợ (lương thực, nước uống, vật dụng)
              </label>
              {fieldMessage('needs')}
            </fieldset>
            <label className="radio sos-danger-check">
              <input
                type="checkbox"
                checked={danger}
                onChange={(e) => {
                  setDanger(e.target.checked);
                  pending.current = null;
                }}
              />{' '}
              Có dấu hiệu nguy hiểm tính mạng theo thông tin tôi biết
            </label>
          </Card>
          <Card className="sos-step-card" aria-labelledby="sos-detail-title">
            <h2 id="sos-detail-title"><span className="sos-step-number" aria-hidden="true">3</span>Chi tiết thêm</h2>
            <div className="form-grid sos-grid-3">
              <label>
                Số người cần hỗ trợ (nếu biết)
                <input
                  data-sos-field="people"
                  aria-invalid={fieldInvalid('people')}
                  type="number"
                  min="1"
                  max="10000"
                  placeholder="Từ 1 đến 10.000"
                  value={people}
                  onChange={(e) => {
                    setPeople(e.target.value);
                    pending.current = null;
                  }}
                />
                {fieldMessage('people')}
              </label>
              <label>
                Trẻ em (nếu biết)
                <input
                  data-sos-field="children"
                  aria-invalid={fieldInvalid('children')}
                  type="number"
                  min="0"
                  max="10000"
                  placeholder="Từ 0 đến 10.000"
                  value={children}
                  onChange={(e) => {
                    setChildren(e.target.value);
                    pending.current = null;
                  }}
                />
                {fieldMessage('children')}
              </label>
              <label>
                Người cao tuổi (nếu biết)
                <input
                  data-sos-field="elderly"
                  aria-invalid={fieldInvalid('elderly')}
                  type="number"
                  min="0"
                  max="10000"
                  placeholder="Từ 0 đến 10.000"
                  value={elderly}
                  onChange={(e) => {
                    setElderly(e.target.value);
                    pending.current = null;
                  }}
                />
                {fieldMessage('elderly')}
              </label>
            </div>
            <label>
              Mô tả tình hình (nếu muốn)
              <textarea
                data-sos-field="description"
                maxLength={2001}
                aria-invalid={fieldInvalid('description')}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  pending.current = null;
                }}
                placeholder="Mô tả ngắn tình trạng và điều cần hỗ trợ"
              />
              {fieldMessage('description')}
            </label>
            <p className="sos-ai-note">
              Mô tả giúp điều phối viên hiểu tình huống và có thể được rút gọn để AI hỗ trợ đánh giá.
              Số điện thoại, tọa độ chính xác và tệp đính kèm không được đưa vào phần đánh giá AI.
              Không nhập thông tin cá nhân không cần thiết trong mô tả.
            </p>
          </Card>
          <Card className="sos-step-card" aria-labelledby="sos-contact-title">
            <h2 id="sos-contact-title"><span className="sos-step-number" aria-hidden="true">4</span>Người liên hệ</h2>
            <div className="form-grid">
              <label>
                Họ tên người báo (nếu muốn)
                <input
                  data-sos-field="name"
                  aria-invalid={fieldInvalid('name')}
                  value={name}
                  maxLength={201}
                  onChange={(e) => {
                    setName(e.target.value);
                    pending.current = null;
                  }}
                />
                {fieldMessage('name')}
              </label>
              <label>
                {mode === 'PROXY' ? 'Số điện thoại người báo hộ (nếu có)' : 'Số điện thoại liên hệ (nếu có)'}
                <input
                  data-sos-field="phone"
                  aria-invalid={fieldInvalid('phone')}
                  type="tel"
                  maxLength={33}
                  inputMode="tel"
                  title="Nhập 8–15 chữ số; có thể thêm dấu + ở đầu"
                  placeholder="Ví dụ: 0912345678"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    pending.current = null;
                  }}
                />
                {fieldMessage('phone')}
              </label>
            </div>
          </Card>
          {mode === 'PROXY' && (
            <Card className="sos-step-card" aria-labelledby="sos-proxy-title">
              <h2 id="sos-proxy-title">Thông tin báo hộ</h2>
              <div className="notice warning">
                Vị trí ở trên phải là vị trí của gia đình cần hỗ trợ, không phải của người báo hộ.
              </div>
              <div className="form-grid sos-proxy-required">
                <label>
                  <span>Quan hệ với gia đình cần hỗ trợ <span className="required-mark" aria-hidden="true">*</span></span>
                  <input required data-sos-field="relationship" maxLength={101} aria-invalid={fieldInvalid('relationship')} value={relationship}
                    onChange={(e) => { setRelationship(e.target.value); pending.current = null; }} />
                  {fieldMessage('relationship')}
                </label>
                <label>
                  <span>Nguồn thông tin <span className="required-mark" aria-hidden="true">*</span></span>
                  <input required data-sos-field="informationSource" maxLength={501} aria-invalid={fieldInvalid('informationSource')} value={informationSource}
                    onChange={(e) => { setInformationSource(e.target.value); pending.current = null; }} />
                  {fieldMessage('informationSource')}
                </label>
                <label>
                  <span>Thời điểm biết tình hình <span className="required-mark" aria-hidden="true">*</span></span>
                  <input required data-sos-field="situationAt" aria-invalid={fieldInvalid('situationAt')} type="datetime-local" value={situationAt}
                    onChange={(e) => { setSituationAt(e.target.value); pending.current = null; }} />
                  {fieldMessage('situationAt')}
                </label>
                <label>
                  Khả năng liên hệ
                  <select value={contactability} onChange={(e) => { setContactability(e.target.value); pending.current = null; }}>
                    <option value="UNKNOWN">Chưa rõ</option>
                    <option value="REACHABLE">Có thể liên hệ</option>
                    <option value="UNREACHABLE">Không thể liên hệ</option>
                  </select>
                </label>
              </div>
              <details className="sos-proxy-contacts" open={proxyContactsOpen}
                onToggle={(event) => setProxyContactsOpen(event.currentTarget.open)}>
                <summary>Thêm liên hệ của gia đình hoặc người liên hệ thay thế <span>Không bắt buộc</span></summary>
              <div className="form-grid">
                <label>
                  Số điện thoại gia đình cần hỗ trợ (nếu biết)
                  <input data-sos-field="beneficiaryPhone" aria-invalid={fieldInvalid('beneficiaryPhone')}
                    type="tel" inputMode="tel" maxLength={33} value={beneficiaryPhone}
                    onChange={(e) => { setBeneficiaryPhone(e.target.value); pending.current = null; }}
                    placeholder="Ví dụ: 0912345678" />
                  {fieldMessage('beneficiaryPhone')}
                </label>
                <label>
                  <span>Tên người liên hệ thay thế (nếu có){Boolean(alternatePhone.trim()) && <> <span className="required-mark" aria-hidden="true">*</span></>}</span>
                  <input data-sos-field="alternateName" aria-invalid={fieldInvalid('alternateName')}
                    maxLength={201} value={alternateName}
                    onChange={(e) => { setAlternateName(e.target.value); pending.current = null; }} />
                  {fieldMessage('alternateName')}
                </label>
                <label>
                  Số điện thoại người liên hệ thay thế (nếu có)
                  <input data-sos-field="alternatePhone" aria-invalid={fieldInvalid('alternatePhone')}
                    type="tel" inputMode="tel" maxLength={33} value={alternatePhone}
                    onChange={(e) => { setAlternatePhone(e.target.value); pending.current = null; }}
                    placeholder="Ví dụ: 0912345678" />
                  {fieldMessage('alternatePhone')}
                </label>
              </div>
              </details>
              {fieldMessage('proxy')}
            </Card>
          )}
          {error && (
            <p role="alert" className="notice error">
              {error}{' '}
              {networkError &&
                'Bạn có thể thử lại với cùng yêu cầu; ứng dụng giữ khóa gửi lại khi trang còn mở.'}
            </p>
          )}
        </div>
      </div>
      <div className="sos-submit-bar">
      <Button type="submit" variant="emergency" size="lg" disabled={busy || Object.keys(clientErrors).length > 0 || Boolean(fieldError)} loading={busy}>
        {busy ? 'Đang gửi…' : 'Gửi yêu cầu SOS'}
      </Button>
      </div>
    </form>
  );
}
