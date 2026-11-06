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

  async function submit(event: FormEvent) {
    event.preventDefault();
    const lon = Number(longitude);
    const lat = Number(latitude);
    if (!longitude.trim() || !latitude.trim() || !Number.isFinite(lon) || !Number.isFinite(lat)
      || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
      setError('Hãy nhập kinh độ từ -180 đến 180 và vĩ độ từ -90 đến 90.');
      return;
    }
    if (note.length > 1000) {
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
        <label>Kinh độ
          <input type="number" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} />
        </label>
        <label>Vĩ độ
          <input type="number" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} />
        </label>
        <label>Ghi chú nguồn vị trí (nếu có)
          <textarea maxLength={1001} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {error && <p className="notice error" role="alert">{error}</p>}
        <button type="submit" className="button" disabled={busy}>
          {busy ? 'Đang cập nhật…' : 'Cập nhật vị trí đội'}
        </button>
      </form>}
    </div>
  );
}
