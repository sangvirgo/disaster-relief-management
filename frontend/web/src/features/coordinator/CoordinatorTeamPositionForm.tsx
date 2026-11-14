import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';

export function CoordinatorTeamPositionForm({
  teamId,
  teamName,
  onSuccess,
}: {
  teamId: string;
  teamName: string;
  onSuccess: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [longitude, setLongitude] = useState('');
  const [latitude, setLatitude] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lon = Number(longitude);
  const lat = Number(latitude);
  const longitudeError = !longitude.trim() ? 'Kinh độ là bắt buộc.'
    : !Number.isFinite(lon) || Math.abs(lon) > 180 ? 'Kinh độ phải từ -180 đến 180.' : '';
  const latitudeError = !latitude.trim() ? 'Vĩ độ là bắt buộc.'
    : !Number.isFinite(lat) || Math.abs(lat) > 90 ? 'Vĩ độ phải từ -90 đến 90.' : '';
  const invalidLocation = Boolean(longitudeError || latitudeError);
  const invalidNote = note.length > 1000;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (invalidLocation) {
      setError('Hãy nhập kinh độ từ -180 đến 180 và vĩ độ từ -90 đến 90.');
      return;
    }
    if (invalidNote) {
      setError('Ghi chú không được vượt quá 1.000 ký tự.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('response', `/teams/${teamId}/position`, {
        method: 'PUT',
        body: {
          location: { type: 'Point', coordinates: [lon, lat], source: 'COORDINATOR_REPORTED' },
          captured_at: new Date().toISOString(),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      setOpen(false);
      setLongitude('');
      setLatitude('');
      setNote('');
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể cập nhật vị trí đội.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="form-stack">
      <button type="button" className="button secondary" aria-expanded={open}
        onClick={() => { setOpen((value) => !value); setError(''); }}>
        {open ? 'Ẩn cập nhật vị trí' : `Báo vị trí mới cho ${teamName}`}
      </button>
      {open && <form className="form-stack" onSubmit={submit} noValidate>
        <p>Chỉ nhập vị trí đội đã xác nhận; thời điểm báo cáo được ghi khi gửi.</p>
        <label><span>Kinh độ <span className="required-mark" aria-hidden="true">*</span></span>
          <input type="number" required min="-180" max="180" step="any" aria-invalid={Boolean(longitude && longitudeError)} value={longitude} onChange={(event) => setLongitude(event.target.value)} />
          {longitude && longitudeError && <small className="field-error" role="alert">{longitudeError}</small>}
        </label>
        <label><span>Vĩ độ <span className="required-mark" aria-hidden="true">*</span></span>
          <input type="number" required min="-90" max="90" step="any" aria-invalid={Boolean(latitude && latitudeError)} value={latitude} onChange={(event) => setLatitude(event.target.value)} />
          {latitude && latitudeError && <small className="field-error" role="alert">{latitudeError}</small>}
        </label>
        <label>Ghi chú nguồn vị trí (nếu có)
          <textarea maxLength={1001} aria-invalid={invalidNote} value={note} onChange={(event) => setNote(event.target.value)} />
          {invalidNote && <small className="field-error" role="alert">Ghi chú không được vượt quá 1.000 ký tự.</small>}
        </label>
        {error && <p className="notice error" role="alert">{error}</p>}
        <button type="submit" className="button" disabled={busy || invalidLocation || invalidNote}>
          {busy ? 'Đang cập nhật…' : 'Cập nhật vị trí đội'}
        </button>
      </form>}
    </div>
  );
}
