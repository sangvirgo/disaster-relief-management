import { useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { LocationPicker, type Point } from '../../maps/LocationPicker';

/**
 * A coordinator reports where a team without its own GPS is: search an address or click the map, never type
 * coordinates. The report time is recorded when it is sent.
 */
export function CoordinatorTeamPositionForm({
  teamId,
  teamName,
  onSuccess,
}: {
  teamId: string;
  teamName: string;
  onSuccess: () => void;
}) {
  const [point, setPoint] = useState<Point | null>(null);
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const invalidNote = note.length > 1000;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!point) { setError('Hãy chọn vị trí của đội trên bản đồ hoặc tìm theo địa chỉ.'); return; }
    if (invalidNote) { setError('Ghi chú không được vượt quá 1.000 ký tự.'); return; }
    setBusy(true);
    setError('');
    const source = [address.trim(), note.trim()].filter(Boolean).join(' — ');
    try {
      await api('response', `/teams/${teamId}/position`, {
        method: 'PUT',
        body: {
          location: { type: 'Point', coordinates: [point.longitude, point.latitude], source: 'COORDINATOR_REPORTED' },
          captured_at: new Date().toISOString(),
          ...(source ? { note: source.slice(0, 1000) } : {}),
        },
      });
      setPoint(null); setAddress(''); setNote('');
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể cập nhật vị trí đội.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-stack team-position-form" onSubmit={submit} noValidate>
      <strong>{teamName}</strong>
      <LocationPicker value={point} initiallyOpen selectOnPick hideToggle
        onSelect={(next, label) => { setPoint(next); setAddress(label ?? ''); setError(''); }}
        onAddressResolved={(_, label) => setAddress(label)} />
      <small className="muted" role="status">
        {point ? `Đã chọn: ${address || `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`}` : 'Tìm địa chỉ hoặc bấm lên bản đồ tại nơi đội đang có mặt.'}
      </small>
      <label>Nguồn thông tin (nếu có)
        <input type="text" maxLength={1001} placeholder="Ví dụ: trưởng nhóm gọi điện báo lúc 14:20" aria-invalid={invalidNote}
          value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      {error && <p className="notice error" role="alert">{error}</p>}
      <button type="submit" className="button primary" disabled={busy || !point || invalidNote}>
        {busy ? 'Đang cập nhật…' : 'Lưu vị trí đội'}
      </button>
    </form>
  );
}
