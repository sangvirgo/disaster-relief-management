import { useRef, useState, type FormEvent } from 'react';
import { api, ApiError, newCommandKey, upload } from '../../api/client';
import { label, timeLabel } from '../../i18n/labels';
import type { components as ResponseComponents } from '../../api/generated/response';
import { LocationPicker, type Point } from '../../maps/LocationPicker';

type Tracking = ResponseComponents['schemas']['ReporterTracking'];
type Evidence = { id: string; state: string; size_bytes: number; created_at: string };
type Event = { id?: string; event_type: string; occurred_at: string; public_text_code?: string };
const headers = (code: string, secret: string) => ({
  'X-Tracking-Code': code.trim(),
  ...(secret.trim() ? { 'X-Tracking-Secret': secret.trim() } : {}),
});

export function TrackingActions({
  tracking,
  code,
  secret,
  canClaim,
  onUpdated,
}: {
  tracking: Tracking;
  code: string;
  secret: string;
  canClaim: boolean;
  onUpdated: () => Promise<void>;
}) {
  const [description, setDescription] = useState('');
  const [people, setPeople] = useState('');
  const [danger, setDanger] = useState(false);
  const [supplementPoint, setSupplementPoint] = useState<Point | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);
  const [gpsCapturedAt, setGpsCapturedAt] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [evidence, setEvidence] = useState<Evidence[] | null>(null);
  const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<Event[]>([]);
  const [cursor, setCursor] = useState<string | null>(tracking.cursor || null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const supplementKey = useRef<string | null>(null);
  const fileKey = useRef<string | null>(null);
  async function supplement(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    setBusy(true);
    try {
      supplementKey.current ||= newCommandKey();
      await api('response', `/requests/${tracking.id}/supplements`, {
        method: 'POST',
        headers: headers(code, secret),
        idempotencyKey: supplementKey.current,
        body: {
          expected_version: tracking.version,
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(people ? { people_affected: Number(people) } : {}),
          ...(danger ? { reporter_declared_danger: true } : {}),
          ...(supplementPoint
            ? {
                location: {
                  type: 'Point',
                  coordinates: [supplementPoint.longitude, supplementPoint.latitude],
                  source: gpsCapturedAt ? 'GPS' : 'MANUAL_PIN',
                  ...(gpsCapturedAt ? { accuracy_m: gpsAccuracy, captured_at: gpsCapturedAt } : {}),
                },
              }
            : {}),
        },
      });
      supplementKey.current = null;
      setDescription('');
      setPeople('');
      setDanger(false);
      setSupplementPoint(null);
      setGpsAccuracy(null);
      setGpsCapturedAt(null);
      setMessage('Thông tin bổ sung đã được máy chủ tiếp nhận.');
      try {
        await onUpdated();
      } catch {
        setMessage(
          'Máy chủ đã tiếp nhận thông tin bổ sung. Hãy tra cứu lại để xem trạng thái mới.'
        );
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Chưa xác nhận được thông tin bổ sung.');
    } finally {
      setBusy(false);
    }
  }
  function locateSupplement() {
    if (!navigator.geolocation) {
      setMessage('Trình duyệt không hỗ trợ xác định vị trí.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) => {
        setSupplementPoint({ longitude: coords.longitude, latitude: coords.latitude });
        setGpsAccuracy(coords.accuracy);
        setGpsCapturedAt(new Date(timestamp).toISOString());
        supplementKey.current = null;
        setMessage('Đã lấy vị trí hiện tại. Hãy kiểm tra trước khi gửi.');
      },
      () => setMessage('Không thể lấy vị trí hiện tại. Hãy thử tìm trên bản đồ.'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }
  async function attach(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setMessage('');
    setBusy(true);
    try {
      fileKey.current ||= newCommandKey();
      const uploaded = await upload<Evidence>(
        'response',
        `/requests/${tracking.id}/evidence`,
        file,
        { headers: headers(code, secret), idempotencyKey: fileKey.current }
      );
      fileKey.current = null;
      setFile(null);
      setMessage('Tệp minh chứng đã được máy chủ tiếp nhận.');
      if (uploaded?.id) setEvidence((current) => [uploaded, ...(current || [])]);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'STORAGE_UNAVAILABLE') fileKey.current = null;
      setMessage(cause instanceof Error ? cause.message : 'Chưa xác nhận được tệp minh chứng.');
    } finally {
      setBusy(false);
    }
  }
  async function loadEvidence() {
    try {
      const result = await api<{ items: Evidence[] }>(
        'response',
        `/requests/${tracking.id}/evidence`,
        { headers: headers(code, secret) }
      );
      setEvidence(result.items);
    } catch (cause) {
      if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
        if (!evidence || evidence.length === 0) {
          setMessage(
            'Tệp minh chứng gửi lên được bảo vệ riêng tư. Điều phối viên sẽ rà soát tệp khi xử lý yêu cầu.'
          );
        }
        return;
      }
      setMessage(cause instanceof Error ? cause.message : 'Không thể tải danh sách minh chứng.');
    }
  }
  async function download(id: string) {
    try {
      const result = await api<{ url: string }>('response', `/evidence/${id}/download`, {
        headers: headers(code, secret),
      });
      setDownloadUrls((current) => ({ ...current, [id]: result.url }));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Không thể mở tệp minh chứng.');
    }
  }
  async function claim() {
    if (
      !window.confirm(
        'Gắn yêu cầu này với tài khoản đang đăng nhập? Mã bảo mật cũ sẽ hết hiệu lực.'
      )
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      await api('response', '/requests/claim', {
        method: 'POST',
        body: { tracking_code: code.trim() },
        headers: { 'X-Tracking-Secret': secret.trim() },
        idempotencyKey: newCommandKey(),
      });
      setMessage(
        'Yêu cầu đã được gắn với tài khoản. Từ lần tra cứu tiếp theo, hãy dùng tài khoản của bạn.'
      );
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Chưa gắn được yêu cầu với tài khoản.');
    } finally {
      setBusy(false);
    }
  }
  async function older() {
    if (!cursor) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ items: Event[]; more: boolean; cursor?: string }>(
        'response',
        `/requests/${tracking.id}/events?cursor=${encodeURIComponent(cursor)}`,
        { headers: headers(code, secret) }
      );
      setEvents((current) => [...current, ...result.items]);
      setCursor(result.more ? result.cursor || null : null);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Không thể tải lịch sử cũ hơn.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>Cập nhật yêu cầu</h2>
      {tracking.can_supplement ? (
        <form className="form-stack" onSubmit={supplement}>
          <p>Thông tin bổ sung sau xác minh sẽ được điều phối viên rà soát trước khi áp dụng.</p>
          <label>
            Mô tả mới
            <textarea
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                supplementKey.current = null;
              }}
            />
          </label>
          <label>
            Số người cần hỗ trợ
            <input
              type="number"
              min="1"
              max="10000"
              value={people}
              onChange={(event) => {
                setPeople(event.target.value);
                supplementKey.current = null;
              }}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={danger}
              onChange={(event) => {
                setDanger(event.target.checked);
                supplementKey.current = null;
              }}
            />{' '}
            Có nguy hiểm tính mạng cần báo ngay
          </label>
          <div>
            <strong>Cập nhật vị trí cần hỗ trợ (nếu đã thay đổi)</strong>
            <p>Vị trí mới sẽ được điều phối viên xem xét trước khi áp dụng.</p>
            <button type="button" className="button secondary" onClick={locateSupplement}>
              Dùng vị trí hiện tại
            </button>
            <LocationPicker
              value={supplementPoint}
              onSelect={(point) => {
                setSupplementPoint(point);
                setGpsAccuracy(null);
                setGpsCapturedAt(null);
                supplementKey.current = null;
              }}
            />
            {supplementPoint && (
              <p role="status">
                Tọa độ đã chọn: {supplementPoint.latitude.toFixed(6)},{' '}
                {supplementPoint.longitude.toFixed(6)}
              </p>
            )}
          </div>
          <button
            className="button"
            disabled={busy || (!description.trim() && !people && !danger && !supplementPoint)}
          >
            Gửi thông tin bổ sung
          </button>
        </form>
      ) : (
        <p>Yêu cầu ở trạng thái hiện tại không nhận thông tin bổ sung.</p>
      )}
      <form className="form-stack" onSubmit={attach}>
        <label>
          Minh chứng riêng tư (JPEG, PNG hoặc MP4)
          <input
            type="file"
            required
            accept="image/jpeg,image/png,video/mp4"
            onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              fileKey.current = null;
            }}
          />
        </label>
        <button className="button secondary" disabled={busy || !file}>
          Tải minh chứng lên
        </button>
      </form>
      <button className="button secondary" type="button" onClick={loadEvidence}>
        Xem tệp minh chứng
      </button>
      {canClaim && secret && (
        <button className="button secondary" type="button" onClick={claim} disabled={busy}>
          Gắn yêu cầu với tài khoản
        </button>
      )}
      {evidence &&
        (evidence.length ? (
          <div className="record-list">
            {evidence.map((item) => (
              <div className="record" key={item.id}>
                <span>
                  {label(item.state)} · {timeLabel(item.created_at)} ·{' '}
                  {Math.ceil(item.size_bytes / 1024)} KB
                </span>
                <span>
                  <button className="button secondary" onClick={() => download(item.id)}>
                    Lấy liên kết riêng tư
                  </button>
                  {downloadUrls[item.id] && (
                    <a
                      className="button secondary"
                      href={downloadUrls[item.id]}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Mở tệp trong 60 giây
                    </a>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p>Chưa có tệp minh chứng.</p>
        ))}
      {events.map((item, index) => (
        <p className="timeline-item" key={item.id || index}>
          {label(item.public_text_code || item.event_type)} · {timeLabel(item.occurred_at)}
        </p>
      ))}
      {cursor && (
        <button className="button secondary" onClick={older} disabled={busy}>
          Xem lịch sử cũ hơn
        </button>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
