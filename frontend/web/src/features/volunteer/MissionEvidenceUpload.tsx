import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, newCommandKey, upload } from '../../api/client';
import { evidenceFileError } from '../../i18n/evidence';

type Entry = { file: File; key: string; state: 'pending' | 'uploading' | 'saved' | 'failed'; error?: string };

/** One upload lifecycle for progress and completion: selection starts uploading, retries keep their command key. */
export function MissionEvidenceUpload({ missionId, disabled, onBusyChange, onSaved }: {
  missionId: string; disabled: boolean; onBusyChange: (busy: boolean) => void; onSaved: () => void;
}) {
  const id = useId();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selectionNotice, setSelectionNotice] = useState('');
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const blocked = entries.some(entry => entry.state !== 'saved');
  useEffect(() => {
    onBusyChange(blocked);
    if (!blocked) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [blocked, onBusyChange]);

  async function send(batch: Entry[]) {
    if (running.current || disabled || !batch.length) return;
    running.current = true;
    onBusyChange(true);
    let saved = false;
    for (const entry of batch) {
      setEntries(current => current.map(row => row.key === entry.key ? { ...row, state: 'uploading', error: undefined } : row));
      try {
        await upload('response', `/missions/${missionId}/evidence`, entry.file, { idempotencyKey: entry.key });
        saved = true;
        if (mounted.current) setEntries(current => current.map(row => row.key === entry.key ? { ...row, state: 'saved' } : row));
      } catch (error) {
        if (mounted.current) setEntries(current => current.map(row => row.key === entry.key ? {
          ...row, state: 'failed',
          // Storage errors are definitive failures; ambiguous transport failures retain the original key.
          key: error instanceof ApiError && error.code === 'STORAGE_UNAVAILABLE' ? newCommandKey() : row.key,
          error: error instanceof Error ? error.message : 'Chưa tải được tệp. Hãy thử lại.',
        } : row));
      }
    }
    running.current = false;
    if (mounted.current) {
      if (saved) onSaved();
    }
  }

  return <section className="mission-evidence-upload" aria-labelledby={`${id}-heading`}>
    <div className="mission-evidence-upload__heading"><h4 id={`${id}-heading`}>Minh chứng hiện trường</h4><small>Chọn tệp để tự tải lên · JPEG, PNG hoặc MP4</small></div>
    <label className="mission-upload-control" data-static-label>
      <input type="file" multiple accept="image/jpeg,image/png,video/mp4" disabled={disabled || running.current}
        aria-label="Thêm ảnh hoặc video minh chứng" aria-describedby={`${id}-hint`}
        onChange={event => {
          const files = Array.from(event.currentTarget.files || []);
          event.currentTarget.value = '';
          if (running.current || disabled) return;
          const signature = (file: File) => JSON.stringify([file.name, file.size, file.lastModified]);
          const seen = new Set(entries.map(row => signature(row.file)));
          const next: Entry[] = files.filter(file => { const value = signature(file); if (seen.has(value)) return false; seen.add(value); return true; })
            .map(file => { const error = evidenceFileError(file); return { file, key: newCommandKey(), state: error ? 'failed' : 'pending', error: error || undefined }; });
          setSelectionNotice(next.length < files.length ? 'Tệp đã có trong danh sách được bỏ qua để tránh tải trùng.' : '');
          setEntries(current => [...current, ...next]);
          void send(next.filter(row => row.state === 'pending'));
        }} />
      <span className="mission-upload-control__button">Thêm ảnh hoặc video</span>
      <span className="mission-upload-control__name" id={`${id}-hint`}>Ảnh tối đa 10 MB · video tối đa 50 MB</span>
    </label>
    {selectionNotice && <p role="status">{selectionNotice}</p>}
    {entries.length > 0 && <ul className="mission-upload-list" aria-live="polite">{entries.map(entry => <li key={entry.key}>
      <div><strong>{entry.file.name}</strong><small className={entry.state === 'failed' ? 'field-error' : ''}>
        {entry.state === 'saved' ? '✓ Đã tải lên' : entry.state === 'uploading' ? 'Đang tải lên…' : entry.state === 'pending' ? 'Đang chờ tải…' : entry.error}
      </small></div>
      {entry.state === 'failed' && <div className="mission-upload-list__actions">
        {!evidenceFileError(entry.file) && <button type="button" className="button secondary" disabled={disabled || running.current} onClick={() => void send([entry])}>Thử lại</button>}
        <button type="button" className="button secondary" disabled={disabled || running.current} onClick={() => setEntries(current => current.filter(row => row.key !== entry.key))}>Bỏ tệp lỗi</button>
      </div>}
    </li>)}</ul>}
    {blocked && !running.current && <p className="field-error" role="alert">Có tệp chưa tải được. Thử lại hoặc bỏ tệp lỗi trước khi kết thúc nhiệm vụ.</p>}
  </section>;
}
