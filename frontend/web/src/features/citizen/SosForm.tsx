import { useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey } from '../../api/client';
import type { Me } from '../../auth/session';
import type { components as ResponseComponents } from '../../api/generated/response';
import { label, timeLabel } from '../../i18n/labels';
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
}: {
  user: Me | null;
  onConfirmed?: (receipt: Created) => void;
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
    pending.current = null;
  }
  function build(): Pending {
    if (!category) throw new Error('Vui lòng chọn loại sự cố.');
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
      throw new Error('Vui lòng cung cấp tọa độ hợp lệ của nơi cần hỗ trợ.');
    if (
      people &&
      (!Number.isInteger(Number(people)) || Number(people) < 1 || Number(people) > 10000)
    )
      throw new Error('Số người cần hỗ trợ phải từ 1 đến 10.000.');
    for (const [label, value] of [
      ['trẻ em', children],
      ['người cao tuổi', elderly],
    ] as const) {
      if (value && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 10000))
        throw new Error(`Số ${label} phải từ 0 đến 10.000.`);
    }
    if (people && Number(children || 0) + Number(elderly || 0) > Number(people))
      throw new Error('Tổng số trẻ em và người cao tuổi không được lớn hơn tổng số người.');
    if (!needsRescue && !needsRelief)
      throw new Error('Hãy chọn ít nhất một nhu cầu: cứu hộ hoặc hàng cứu trợ.');
    if (mode === 'PROXY' && !user) throw new Error('Vui lòng đăng nhập để báo hộ.');
    if (mode === 'PROXY' && (!relationship.trim() || !informationSource.trim() || !situationAt))
      throw new Error('Vui lòng nhập quan hệ, nguồn thông tin và thời điểm biết tình hình.');
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
      setError(cause instanceof Error ? cause.message : 'Chưa gửi được yêu cầu. Vui lòng thử lại.');
    } finally {
      setBusy(false);
    }
  }
  if (created)
    return (
      <section className="card confirmation" role="status">
        <span className="eyebrow">Máy chủ đã xác nhận</span>
        <h2>Yêu cầu đã được tiếp nhận</h2>
        <p>
          Mã theo dõi: <strong>{created.tracking_code}</strong>
        </p>
        <p>
          Trạng thái: {label(created.status)} · Thời điểm: {timeLabel(created.received_at)}
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
      </section>
    );
  return (
    <form className="card form-stack sos-form" onSubmit={submit}>
      <h2>Thông tin yêu cầu hỗ trợ</h2>
      <p>
        Vị trí phải là nơi cần hỗ trợ. Yêu cầu chỉ được ghi nhận khi máy chủ trả về mã theo dõi.
      </p>
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
          Loại sự cố
          <select
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
        </label>
        <label>
          Số người cần hỗ trợ (nếu biết)
          <input
            type="number"
            min="1"
            max="10000"
            value={people}
            onChange={(e) => {
              setPeople(e.target.value);
              pending.current = null;
            }}
          />
        </label>
        <label>
          Trẻ em (nếu biết)
          <input
            type="number"
            min="0"
            max="10000"
            value={children}
            onChange={(e) => {
              setChildren(e.target.value);
              pending.current = null;
            }}
          />
        </label>
        <label>
          Người cao tuổi (nếu biết)
          <input
            type="number"
            min="0"
            max="10000"
            value={elderly}
            onChange={(e) => {
              setElderly(e.target.value);
              pending.current = null;
            }}
          />
        </label>
        <label>
          Họ tên người báo (nếu muốn)
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              pending.current = null;
            }}
          />
        </label>
        <label>
          Số điện thoại liên hệ (nếu có)
          <input
            type="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              pending.current = null;
            }}
          />
        </label>
      </div>
      <label>
        Mô tả tình hình
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
        Mô tả ngắn được gửi đến Gemini để trích xuất dữ kiện thành JSON. Không nhập tên, số điện
        thoại, số giấy tờ hoặc địa chỉ cụ thể. Điều phối viên sẽ xem xét mọi gợi ý AI.
      </div>
      <fieldset className="sos-needs">
        <legend>Nhu cầu cần hỗ trợ</legend>
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
      <div className="location-heading">
        <h3>Vị trí cần hỗ trợ</h3>
        <button type="button" className="button secondary" onClick={locate}>
          Dùng vị trí hiện tại
        </button>
      </div>
      <LocationPicker
        value={
          longitude && latitude
            ? { longitude: Number(longitude), latitude: Number(latitude) }
            : null
        }
        onSelect={chooseMapPoint}
      />
      <div className="form-grid">
        <label>
          Kinh độ
          <input
            type="number"
            step="any"
            required
            value={longitude}
            onChange={(e) => changeCoordinates(setLongitude, e.target.value)}
            placeholder="Ví dụ: 106.70"
          />
        </label>
        <label>
          Vĩ độ
          <input
            type="number"
            step="any"
            required
            value={latitude}
            onChange={(e) => changeCoordinates(setLatitude, e.target.value)}
            placeholder="Ví dụ: 10.77"
          />
        </label>
      </div>
      {mode === 'PROXY' && (
        <>
          <div className="notice warning">
            Vị trí ở trên phải là vị trí của gia đình cần hỗ trợ, không phải của người báo hộ.
          </div>
          <div className="form-grid">
            <label>
              Quan hệ với gia đình cần hỗ trợ
              <input
                required
                value={relationship}
                onChange={(e) => {
                  setRelationship(e.target.value);
                  pending.current = null;
                }}
              />
            </label>
            <label>
              Nguồn thông tin
              <input
                required
                value={informationSource}
                onChange={(e) => {
                  setInformationSource(e.target.value);
                  pending.current = null;
                }}
              />
            </label>
            <label>
              Thời điểm biết tình hình
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
