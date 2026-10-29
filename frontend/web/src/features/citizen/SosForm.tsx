import { useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey } from '../../api/client';
import type { Me } from '../../auth/session';
import type { components as ResponseComponents } from '../../api/generated/response';
import { requestStatusLabel, timeLabel } from '../../i18n/labels';
import { LocationPicker } from '../../maps/LocationPicker';

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
  const [mode, setMode] = useState<'SELF' | 'PROXY'>('SELF');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [people, setPeople] = useState('');
  const [children, setChildren] = useState('');
  const [elderly, setElderly] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [danger, setDanger] = useState(false);
  const [needsRescue, setNeedsRescue] = useState(true);
  const [needsRelief, setNeedsRelief] = useState(false);
  const [longitude, setLongitude] = useState('');
  const [latitude, setLatitude] = useState('');
  const [source, setSource] = useState<'MANUAL_PIN' | 'GPS'>('MANUAL_PIN');
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [relationship, setRelationship] = useState('');
  const [informationSource, setInformationSource] = useState('');
  const [situationAt, setSituationAt] = useState('');
  const [contactability, setContactability] = useState('UNKNOWN');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldError, setFieldError] = useState<{ field: string; message: string } | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [ackSecret, setAckSecret] = useState('');
  const pending = useRef<Pending | null>(null);

  function locate() {
    if (!navigator.geolocation) {
      setError('Trình duyệt không hỗ trợ xác định vị trí. Hãy nhập tọa độ vị trí cần hỗ trợ.');
      return;
    }
    setError('');
    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) => {
        setLongitude(String(coords.longitude));
        setLatitude(String(coords.latitude));
        setAccuracy(coords.accuracy);
        setCaptured(new Date(timestamp).toISOString());
        setSource('GPS');
        setFieldError(null);
      },
      () => setError('Không thể lấy vị trí. Hãy nhập tọa độ vị trí cần hỗ trợ.'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }
  function changeCoordinates(setter: (value: string) => void, value: string) {
    setter(value);
    setSource('MANUAL_PIN');
    setAccuracy(null);
    setCaptured(null);
    pending.current = null;
  }
  function chooseMapPoint(point: { longitude: number; latitude: number } | null) {
    setLongitude(point ? String(point.longitude) : '');
    setLatitude(point ? String(point.latitude) : '');
    setSource('MANUAL_PIN');
    setAccuracy(null);
    setCaptured(null);
    setFieldError(null);
    pending.current = null;
  }
  function build(): Pending {
    const invalid = (field: string, message: string): never => {
      throw Object.assign(new Error(message), { field });
    };
    if (!category) invalid('category', 'Vui lòng chọn loại sự cố.');
    if (name.trim().length > 200) invalid('name', 'Họ tên người báo không được quá 200 ký tự.');
    if (phone.trim()) {
      const normalizedPhone = phone.trim().replace(/[ ()-]/g, '');
      if (normalizedPhone.length > 16 || !/^\+?[0-9]{8,15}$/.test(normalizedPhone))
        invalid('phone', 'Số điện thoại cần có 8–15 chữ số; có thể thêm dấu + ở đầu.');
    }
    const lon = Number(longitude),
      lat = Number(latitude);
    if (
      !longitude ||
      !latitude ||
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      Math.abs(lon) > 180 ||
      Math.abs(lat) > 90
    )
      invalid('location', 'Vui lòng chọn vị trí hợp lệ của nơi cần hỗ trợ.');
    if (
      people &&
      (!Number.isInteger(Number(people)) || Number(people) < 1 || Number(people) > 10000)
    )
      invalid('people', 'Số người cần hỗ trợ phải từ 1 đến 10.000.');
    for (const [label, value] of [
      ['trẻ em', children],
      ['người cao tuổi', elderly],
    ] as const) {
      if (value && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 10000))
        invalid(label === 'trẻ em' ? 'children' : 'elderly', `Số ${label} phải từ 0 đến 10.000.`);
    }
    if (people && Number(children || 0) + Number(elderly || 0) > Number(people))
      invalid('people', 'Tổng số trẻ em và người cao tuổi không được lớn hơn tổng số người.');
    if (!needsRescue && !needsRelief)
      invalid('needs', 'Hãy chọn ít nhất một nhu cầu: cứu hộ hoặc hàng cứu trợ.');
    if (mode === 'PROXY' && !user) invalid('mode', 'Vui lòng đăng nhập để báo hộ.');
    if (mode === 'PROXY' && (!relationship.trim() || !informationSource.trim() || !situationAt))
      invalid('proxy', 'Vui lòng nhập quan hệ, nguồn thông tin và thời điểm biết tình hình.');
    if (mode === 'PROXY' && (relationship.trim().length > 100 || informationSource.trim().length > 500))
      invalid('proxy', 'Quan hệ tối đa 100 ký tự và nguồn thông tin tối đa 500 ký tự.');
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
    setError('');
    setFieldError(null);
    setBusy(true);
    try {
      const command = pending.current || build();
      pending.current = command;
      const result = await api<Created>('response', command.path, {
        method: 'POST',
        body: command.body,
        idempotencyKey: command.key,
        headers: command.secret ? { 'X-Tracking-Secret': command.secret } : {},
      });
      setAckSecret(command.secret);
      setCreated(result);
      onConfirmed?.(result);
      pending.current = null;
    } catch (cause) {
      if (cause instanceof Error && 'field' in cause && typeof cause.field === 'string') {
        setFieldError({ field: cause.field, message: cause.message });
        document.querySelector<HTMLElement>(`[data-sos-field="${cause.field}"]`)?.focus();
      } else {
        setError(cause instanceof Error ? cause.message : 'Chưa gửi được yêu cầu. Vui lòng thử lại.');
      }
    } finally {
      setBusy(false);
    }
  }
  const fieldMessage = (field: string) => fieldError?.field === field
    ? <span className="sos-field-error" role="alert">{fieldError.message}</span>
    : null;
  if (created)
    return (
      <section className="card confirmation" role="status">
        <span className="eyebrow">Máy chủ đã xác nhận</span>
        <h2>Yêu cầu đã được tiếp nhận</h2>
        <p>
          Mã theo dõi: <strong>{created.tracking_code}</strong>
        </p>
        <p>
          Trạng thái: {requestStatusLabel(created.status)} · Thời điểm: {timeLabel(created.received_at)}
        </p>
        {ackSecret && (
          <div className="notice warning">
            <strong>Lưu mã bảo mật này ngay:</strong>
            <div className="secret">{ackSecret}</div>
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
        {user && onTrack && (
          <button type="button" className="button" onClick={() => onTrack(created.tracking_code)}>
            Theo dõi tiến độ
          </button>
        )}
      </section>
    );
  return (
    <form className="card form-stack sos-form" onSubmit={submit} onChange={() => setFieldError(null)} noValidate>
      <h2>Thông tin yêu cầu hỗ trợ</h2>
      <p>
        Vị trí phải là nơi cần hỗ trợ. Yêu cầu chỉ được ghi nhận khi máy chủ trả về mã theo dõi.
      </p>
      <button type="button" className="button secondary sos-location-jump"
        onClick={() => document.getElementById('sos-location')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
        Chuyển tới chọn vị trí
      </button>
      <p className="sos-required-note"><span aria-hidden="true">*</span> Trường bắt buộc</p>
      {user && (
        <fieldset>
          <legend>Người cần hỗ trợ</legend>
          <label className="radio">
            <input
              type="radio"
              checked={mode === 'SELF'}
              onChange={() => {
                setMode('SELF');
                pending.current = null;
              }}
            />{' '}
            Tôi hoặc người trong gia đình
          </label>
          <label className="radio">
            <input
              type="radio"
              checked={mode === 'PROXY'}
              onChange={() => {
                setMode('PROXY');
                pending.current = null;
              }}
            />{' '}
            Tôi báo hộ gia đình khác
          </label>
        </fieldset>
      )}
      <div className="form-grid">
        <label>
          <span>Loại sự cố <span className="required-mark" aria-hidden="true">*</span></span>
          <select
            data-sos-field="category"
            aria-invalid={fieldError?.field === 'category'}
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
        <label>
          Số người cần hỗ trợ (nếu biết)
          <input
            data-sos-field="people"
            aria-invalid={fieldError?.field === 'people'}
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
            aria-invalid={fieldError?.field === 'children'}
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
            aria-invalid={fieldError?.field === 'elderly'}
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
        <label>
          Họ tên người báo (nếu muốn)
          <input
            data-sos-field="name"
            aria-invalid={fieldError?.field === 'name'}
            value={name}
            maxLength={200}
            onChange={(e) => {
              setName(e.target.value);
              pending.current = null;
            }}
          />
          {fieldMessage('name')}
        </label>
        <label>
          Số điện thoại liên hệ (nếu có)
          <input
            data-sos-field="phone"
            aria-invalid={fieldError?.field === 'phone'}
            type="tel"
            maxLength={32}
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
      <label>
        Mô tả tình hình (nếu muốn)
        <textarea
          maxLength={2000}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            pending.current = null;
          }}
          placeholder="Mô tả ngắn tình trạng và điều cần hỗ trợ"
        />
      </label>
      <div className="notice warning">
        Mô tả giúp điều phối viên hiểu tình huống và có thể được rút gọn để AI hỗ trợ đánh giá.
        Số điện thoại, tọa độ chính xác và tệp đính kèm không được đưa vào phần đánh giá AI.
        Không nhập thông tin cá nhân không cần thiết trong mô tả.
      </div>
      <fieldset className="sos-needs">
        <legend>Nhu cầu cần hỗ trợ <span className="required-mark" aria-hidden="true">*</span></legend>
        <label className="radio">
          <input
            type="checkbox"
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
      <label className="radio">
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
      <div className="location-heading" id="sos-location">
        <h3>Vị trí cần hỗ trợ <span className="required-mark" aria-hidden="true">*</span></h3>
        <button type="button" className="button secondary" onClick={locate}>
          Dùng vị trí hiện tại
        </button>
      </div>
      {fieldMessage('location')}
      <LocationPicker
        value={
          longitude && latitude
            ? { longitude: Number(longitude), latitude: Number(latitude) }
            : null
        }
        onSelect={chooseMapPoint}
      />
      <details className="sos-coordinate-details">
        <summary>Chi tiết tọa độ {longitude && latitude ? `· ${Number(latitude).toFixed(5)}, ${Number(longitude).toFixed(5)}` : '· có thể nhập thủ công'}</summary>
        <p className="muted">Tọa độ đã xác nhận trên bản đồ là vị trí dùng để gửi SOS; địa chỉ tìm được chỉ mang tính gần đúng.</p>
      <div className="form-grid">
        <label>
          <span>Kinh độ <span className="required-mark" aria-hidden="true">*</span></span>
          <input
            data-sos-field="location"
            type="number"
            step="any"
            min="-180"
            max="180"
            required
            value={longitude}
            onChange={(e) => changeCoordinates(setLongitude, e.target.value)}
            placeholder="Ví dụ: 106.70"
          />
        </label>
        <label>
          <span>Vĩ độ <span className="required-mark" aria-hidden="true">*</span></span>
          <input
            type="number"
            step="any"
            min="-90"
            max="90"
            required
            value={latitude}
            onChange={(e) => changeCoordinates(setLatitude, e.target.value)}
            placeholder="Ví dụ: 10.77"
          />
        </label>
      </div>
      </details>
      {mode === 'PROXY' && (
        <>
          <div className="notice warning">
            Vị trí ở trên phải là vị trí của gia đình cần hỗ trợ, không phải của người báo hộ.
          </div>
          <div className="form-grid">
            <label>
              <span>Quan hệ với gia đình cần hỗ trợ <span className="required-mark" aria-hidden="true">*</span></span>
              <input
                required
                maxLength={100}
                value={relationship}
                onChange={(e) => {
                  setRelationship(e.target.value);
                  pending.current = null;
                }}
              />
            </label>
            <label>
              <span>Nguồn thông tin <span className="required-mark" aria-hidden="true">*</span></span>
              <input
                required
                maxLength={500}
                value={informationSource}
                onChange={(e) => {
                  setInformationSource(e.target.value);
                  pending.current = null;
                }}
              />
            </label>
            <label>
              <span>Thời điểm biết tình hình <span className="required-mark" aria-hidden="true">*</span></span>
              <input
                required
                type="datetime-local"
                value={situationAt}
                onChange={(e) => {
                  setSituationAt(e.target.value);
                  pending.current = null;
                }}
              />
            </label>
            <label>
              Khả năng liên hệ
              <select
                value={contactability}
                onChange={(e) => {
                  setContactability(e.target.value);
                  pending.current = null;
                }}
              >
                <option value="UNKNOWN">Chưa rõ</option>
                <option value="REACHABLE">Có thể liên hệ</option>
                <option value="UNREACHABLE">Không thể liên hệ</option>
              </select>
            </label>
          </div>
          {fieldMessage('proxy')}
        </>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}{' '}
          {error.includes('kết nối') &&
            'Bạn có thể thử lại với cùng yêu cầu; ứng dụng giữ khóa gửi lại khi trang còn mở.'}
        </p>
      )}
      <button type="submit" className="button" disabled={busy}>
        {busy ? 'Đang gửi…' : 'Gửi yêu cầu SOS'}
      </button>
      <small>
        Nếu chưa biết rõ loại sự cố, hãy chọn “Chưa rõ” và mô tả tình huống bằng lời của bạn.
      </small>
    </form>
  );
}
