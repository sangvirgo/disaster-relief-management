import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, newCommandKey, upload } from '../../api/client';
import { label, timeLabel } from '../../i18n/labels';
import { evidenceFileError } from '../../i18n/evidence';
import { SelectedFiles } from '../../components/ui/SelectedFiles';
import type { components as ResponseComponents } from '../../api/generated/response';
import { LocationPicker, type Point } from '../../maps/LocationPicker';
import { confirmAction } from '../../components/confirmAction';

type Tracking = ResponseComponents['schemas']['ReporterTracking'];
type Evidence = { id: string; state: string; size_bytes: number; created_at: string; detected_mime?: string };
type Event = { id?: string; event_type: string; occurred_at: string; public_text_code?: string };
const headers = (code: string) => ({
  'X-Tracking-Code': code.trim(),
});

export function TrackingActions({
  tracking,
  code,
  canClaim,
  onUpdated,
}: {
  tracking: Tracking;
  code: string;
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
  const fileError = file ? evidenceFileError(file) : null;
  const [evidence, setEvidence] = useState<Evidence[]>(() => tracking.evidence ?? []);
  const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>({});
  const [evidenceErrors, setEvidenceErrors] = useState<Record<string, boolean>>({});
  const [downloadingId, setDownloadingId] = useState('');
  const [events, setEvents] = useState<Event[]>([]);
  const [cursor, setCursor] = useState<string | null>(tracking.cursor || null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [supplementTouched, setSupplementTouched] = useState<Record<string, boolean>>({});
  const [supplementAttempted, setSupplementAttempted] = useState(false);
  const supplementKey = useRef<string | null>(null);
  const fileKey = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const locationAttempt = useRef(0);
  useEffect(() => () => { locationAttempt.current++; }, []);
  useEffect(() => {
    setEvidence(tracking.evidence ?? []);
    setDownloadUrls({});
    setEvidenceErrors({});
  }, [tracking.id, code]);
  useEffect(() => {
    let active = true;
    const files = evidence.filter((item) => item.state === 'READY');
    if (!files.length) return;
    void Promise.all(files.map(async (item) => {
      try {
        const result = await api<{ url: string }>('response', `/evidence/${item.id}/download`, { headers: headers(code) });
        if (active) setDownloadUrls((current) => ({ ...current, [item.id]: result.url }));
      } catch {
        if (active) setEvidenceErrors((current) => ({ ...current, [item.id]: true }));
      }
    }));
    return () => { active = false; };
  }, [code, evidence]);
  const descriptionError = description.length > 2000 ? 'Mô tả mới không được vượt quá 2.000 ký tự.' : '';
  const peopleError = people && (!Number.isInteger(Number(people)) || Number(people) < 1 || Number(people) > 10000)
    ? 'Số người cần hỗ trợ phải là số nguyên từ 1 đến 10.000.' : '';
  const hasSupplementChanges = Boolean(description.trim() || people || danger || supplementPoint);
  const hasSubmission = hasSupplementChanges || Boolean(file);
  const supplementInvalid = Boolean(descriptionError || peopleError);
  async function supplement(event: FormEvent) {
    event.preventDefault();
    setSupplementAttempted(true);
    if (supplementInvalid || fileError || !hasSubmission) return;
    setMessage('');
    setBusy(true);
    let informationSaved = false;
    try {
      if (hasSupplementChanges) {
        supplementKey.current ||= newCommandKey();
        await api('response', `/requests/${tracking.id}/supplements`, {
          method: 'POST',
          headers: headers(code),
          idempotencyKey: supplementKey.current,
          body: {
            expected_version: tracking.version,
            ...(description.trim() ? { description: description.trim() } : {}),
            ...(people ? { people_affected: Number(people) } : {}),
            ...(danger ? { reporter_declared_danger: true } : {}),
            ...(supplementPoint ? { location: {
              type: 'Point', coordinates: [supplementPoint.longitude, supplementPoint.latitude],
              source: gpsCapturedAt ? 'GPS' : 'MANUAL_PIN',
              ...(gpsCapturedAt ? { accuracy_m: gpsAccuracy, captured_at: gpsCapturedAt } : {}),
            } } : {}),
          },
        });
        informationSaved = true;
        supplementKey.current = null;
        setDescription('');
        setPeople('');
        setDanger(false);
        locationAttempt.current++;
        setSupplementPoint(null);
        setGpsAccuracy(null);
        setGpsCapturedAt(null);
      }
      if (file) {
        try {
          fileKey.current ||= newCommandKey();
          const uploaded = await upload<Evidence>('response', `/requests/${tracking.id}/evidence`, file,
            { headers: headers(code), idempotencyKey: fileKey.current });
          fileKey.current = null;
          setFile(null);
          if (fileInputRef.current) fileInputRef.current.value = '';
          if (uploaded?.id) setEvidence((current) => [uploaded, ...current]);
        } catch (cause) {
          if (cause instanceof ApiError && cause.code === 'STORAGE_UNAVAILABLE') fileKey.current = null;
          if (informationSaved) await onUpdated().catch(() => undefined);
          setMessage(`${informationSaved ? 'Thông tin bổ sung đã được tiếp nhận, nhưng ' : ''}Chưa tải được ảnh hoặc video. ${cause instanceof Error ? cause.message : 'Hãy thử gửi lại tệp.'}`);
          return;
        }
      }
      setMessage(hasSupplementChanges ? 'Thông tin bổ sung đã được máy chủ tiếp nhận.' : 'Ảnh hoặc video hiện trường đã được máy chủ tiếp nhận.');
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
    const attempt = ++locationAttempt.current;
    if (!navigator.geolocation) {
      setMessage('Trình duyệt không hỗ trợ xác định vị trí.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) => {
        if (attempt !== locationAttempt.current) return;
        setSupplementPoint({ longitude: coords.longitude, latitude: coords.latitude });
        setGpsAccuracy(coords.accuracy);
        setGpsCapturedAt(new Date(timestamp).toISOString());
        supplementKey.current = null;
        setMessage('Đã lấy vị trí hiện tại. Hãy kiểm tra trước khi gửi.');
      },
      () => { if (attempt === locationAttempt.current) setMessage('Không thể lấy vị trí hiện tại. Hãy thử tìm trên bản đồ.'); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }
  async function download(id: string) {
    setDownloadingId(id);
    setEvidenceErrors((current) => ({ ...current, [id]: false }));
    try {
      const result = await api<{ url: string }>('response', `/evidence/${id}/download`, {
        headers: headers(code),
      });
      setDownloadUrls((current) => ({ ...current, [id]: result.url }));
    } catch (cause) {
      setEvidenceErrors((current) => ({ ...current, [id]: true }));
    } finally {
      setDownloadingId('');
    }
  }
  async function claim() {
    if (
      !(await confirmAction(
        'Gắn yêu cầu này với tài khoản đang đăng nhập?'
      ))
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      await api('response', '/requests/claim', {
        method: 'POST',
        body: { tracking_code: code.trim() },
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
        { headers: headers(code) }
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
        <form className="form-stack" onSubmit={supplement} noValidate>
          <p>Thông tin bổ sung sau xác minh sẽ được điều phối viên rà soát trước khi áp dụng.</p>
          <label>
            Mô tả tình hình cập nhật
            <textarea
              maxLength={2001}
              aria-invalid={Boolean((supplementAttempted || supplementTouched.description) && descriptionError)}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setSupplementTouched((current) => ({ ...current, description: true }));
                supplementKey.current = null;
              }}
              onBlur={() => setSupplementTouched((current) => ({ ...current, description: true }))}
            />
            <small>Nội dung được chấp nhận sẽ thay thế mô tả hiện tại. Hãy giữ lại các chi tiết còn đúng như người mắc kẹt, người cần dìu và lối tiếp cận.</small>
            {(supplementAttempted || supplementTouched.description) && descriptionError && <small className="field-error" role="alert">{descriptionError}</small>}
          </label>
          <label>
            Số người cần hỗ trợ
            <input
              type="number"
              min="1"
              max="10000"
              aria-invalid={Boolean((supplementAttempted || supplementTouched.people) && peopleError)}
              value={people}
              onChange={(event) => {
                setPeople(event.target.value);
                setSupplementTouched((current) => ({ ...current, people: true }));
                supplementKey.current = null;
              }}
              onBlur={() => setSupplementTouched((current) => ({ ...current, people: true }))}
            />
            {(supplementAttempted || supplementTouched.people) && peopleError && <small className="field-error" role="alert">{peopleError}</small>}
          </label>
          <label className="tracking-danger-toggle">
            <input
              type="checkbox"
              checked={danger}
              onChange={(event) => {
                setDanger(event.target.checked);
                supplementKey.current = null;
              }}
            />
            <span>Có nguy hiểm tính mạng cần báo ngay</span>
          </label>
          <div>
            <strong>Cập nhật vị trí cần hỗ trợ (nếu đã thay đổi)</strong>
            <p>Vị trí mới sẽ được điều phối viên xem xét trước khi áp dụng.</p>
            <p>Chỉ dùng vị trí hiện tại khi bạn đang ở nơi cần hỗ trợ. Nếu báo hộ từ xa, hãy chọn vị trí của người cần hỗ trợ trên bản đồ.</p>
            <button type="button" className="button secondary" onClick={locateSupplement}>
              Dùng vị trí hiện tại
            </button>
            <LocationPicker
              value={supplementPoint}
              onSelect={(point) => {
                locationAttempt.current++;
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
          <div className="tracking-evidence-section">
            <h3>Ảnh và video hiện trường (nếu có)</h3>
            <p>Chỉ điều phối viên và người có quyền theo dõi SOS được xem các tệp này.</p>
            <label className="tracking-file-picker">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,video/mp4"
                aria-invalid={Boolean(fileError)}
                aria-describedby={fileError ? 'sos-evidence-file-error' : undefined}
                onChange={(event) => {
                  setFile(event.target.files?.[0] || null);
                  fileKey.current = null;
                  setMessage('');
                }}
              />
              <span className="tracking-file-icon" aria-hidden="true">↑</span>
              <span>
                <strong>{file ? file.name : 'Chọn ảnh hoặc video'}</strong>
                <small>JPEG, PNG hoặc MP4</small>
              </span>
            </label>
            <SelectedFiles files={file ? [file] : []} onRemove={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; fileKey.current = null; }} />
            {fileError && <small className="field-error" id="sos-evidence-file-error" role="alert">{fileError}</small>}
          </div>
          <button
            className="button"
            disabled={busy || !hasSubmission || supplementInvalid || Boolean(fileError)}
          >
            {busy ? 'Đang gửi…' : 'Gửi thông tin bổ sung'}
          </button>
        </form>
      ) : (
        <p>Yêu cầu ở trạng thái hiện tại không nhận thông tin bổ sung.</p>
      )}
      {canClaim && (
        <button className="button secondary" type="button" onClick={claim} disabled={busy}>
          Gắn yêu cầu với tài khoản
        </button>
      )}
      {evidence.length > 0 && (
        <div className="tracking-recent-evidence">
          <h3>Tệp đã gửi cho SOS này</h3>
          <div className="record-list">
            {evidence.map((item) => (
              <div className="record tracking-evidence-record" key={item.id}>
                {downloadUrls[item.id] && item.detected_mime?.startsWith('image/') &&
                  <a href={downloadUrls[item.id]} target="_blank" rel="noopener noreferrer" aria-label="Xem ảnh hiện trường cỡ lớn">
                    <img src={downloadUrls[item.id]} alt="Ảnh hiện trường đã gửi" loading="lazy" onError={() => { setDownloadUrls((current) => ({ ...current, [item.id]: '' })); setEvidenceErrors((current) => ({ ...current, [item.id]: true })); }} />
                  </a>}
                {downloadUrls[item.id] && item.detected_mime?.startsWith('video/') &&
                  <video src={downloadUrls[item.id]} controls preload="metadata" aria-label="Video hiện trường đã gửi" />}
                <span>
                  {label(item.state)} · {timeLabel(item.created_at)} ·{' '}
                  {Math.ceil(item.size_bytes / 1024)} KB
                </span>
                {item.state === 'READY' && !downloadUrls[item.id] && !evidenceErrors[item.id] && <span role="status">Đang tải minh chứng…</span>}
                {evidenceErrors[item.id] && <button className="button secondary" type="button" disabled={downloadingId === item.id} onClick={() => download(item.id)}>
                  {downloadingId === item.id ? 'Đang tải…' : 'Tải lại minh chứng'}
                </button>}
                {downloadUrls[item.id] && !item.detected_mime?.startsWith('image/') && !item.detected_mime?.startsWith('video/') &&
                  <a className="button secondary" href={downloadUrls[item.id]} target="_blank" rel="noopener noreferrer">Mở tệp</a>}
              </div>
            ))}
          </div>
        </div>
      )}
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
