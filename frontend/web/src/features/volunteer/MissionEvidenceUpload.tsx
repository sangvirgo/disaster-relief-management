import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, newCommandKey, upload } from '../../api/client';
import { LIST_PAGE_SIZE, useCursorNav } from '../../api/useCursorNav';
import { ListNav } from '../../components/ui/Pager';
import { evidenceFileError } from '../../i18n/evidence';
import { useUnsavedWork } from '../../app/useUnsavedWork';
import { fileSignature, nextUploadKey, type UploadEntry as Entry } from './missionEvidenceState';
import { evidenceStorageGeneration, loadPendingEvidence, removePendingEvidence, savePendingEvidence } from './missionEvidenceStorage';


/** One upload lifecycle for progress and completion: selection starts uploading, retries keep their command key. */
export function MissionEvidenceUpload({ userId, missionId, disabled, onBusyChange, onSaved }: {
  userId: string; missionId: string; disabled: boolean; onBusyChange: (busy: boolean) => void; onSaved: () => void;
}) {
  const id = useId();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [cursor, setCursor, prevPage, page] = useCursorNav<string>('');
  const start = Number(cursor || 0);
  const shown = entries.slice(start, start + LIST_PAGE_SIZE);
  useEffect(() => { if (start && start >= entries.length) setCursor(''); }, [start, entries.length, setCursor]);
  const [selectionNotice, setSelectionNotice] = useState('');
  const [restoredQueue, setRestoredQueue] = useState(false);
  const [storageWarning, setStorageWarning] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const generation = useRef(evidenceStorageGeneration());
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let live = true;
    void loadPendingEvidence(userId, missionId).then(rows => {
      if (!live) return;
      setEntries(rows);
      setRestoredQueue(rows.length > 0);
    }).catch(() => { if (live) setStorageWarning('Không giữ được tệp qua F5 trên trình duyệt này. Giữ trang mở đến khi tải xong.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; mounted.current = false; };
  }, [userId, missionId]);
  const blocked = entries.some(entry => entry.state !== 'saved');
  useUnsavedWork(entries.some(entry => entry.state !== 'saved' && !entry.persisted), 'Có tệp chưa được giữ trên thiết bị. F5 hoặc rời trang có thể làm mất tệp này. Bạn vẫn muốn rời đi?');
  useEffect(() => {
    onBusyChange(loading || blocked);
  }, [blocked, loading, onBusyChange]);

  async function persist(entry: Entry, previousKey?: string) {
    try {
      const persisted = await savePendingEvidence(userId, missionId, entry, generation.current, previousKey);
      if (mounted.current) setEntries(current => current.map(row => row.key === entry.key ? { ...row, persisted } : row));
    } catch {
      if (mounted.current) {
        setEntries(current => current.map(row => row.key === entry.key ? { ...row, persisted: false } : row));
        setStorageWarning('Không giữ được tệp qua F5. Giữ trang mở và thử tải lại khi kết nối ổn định.');
      }
    }
  }

  async function send(batch: Entry[]) {
    if (running.current || disabled || !batch.length) return;
    running.current = true;
    setWorking(true);
    onBusyChange(true);
    let saved = false;
    // Save the whole selection before the first request so Back/F5 cannot lose later files.
    for (const entry of batch) await persist(entry);
    for (const original of batch) {
      if (!mounted.current || generation.current !== evidenceStorageGeneration()) break;
      const entry: Entry = { ...original, state: 'uploading', error: undefined };
      setEntries(current => current.map(row => row.key === entry.key ? { ...row, state: 'uploading', error: undefined } : row));
      await persist(entry);
      if (!mounted.current || generation.current !== evidenceStorageGeneration()) break;
      try {
        await upload('response', `/missions/${missionId}/evidence`, entry.file, { idempotencyKey: entry.key });
        saved = true;
        if (mounted.current) setEntries(current => current.map(row => row.key === entry.key ? { ...row, state: 'saved' } : row));
        await removePendingEvidence(entry.key).catch(() => {});
      } catch (error) {
        const failed: Entry = {
          ...entry, state: 'failed',
          // Storage errors are definitive failures; ambiguous transport failures retain the original key.
          key: nextUploadKey(error instanceof ApiError ? error.code : undefined, entry.key, newCommandKey),
          error: error instanceof Error ? error.message : 'Chưa tải được tệp. Hãy thử lại.',
        };
        if (mounted.current) setEntries(current => current.map(row => row.key === entry.key ? failed : row));
        await persist(failed, entry.key);
      }
    }
    running.current = false;
    if (mounted.current) {
      setWorking(false);
      if (saved) { setSelectionNotice(''); onSaved(); }
    }
  }

  return <section className="mission-evidence-upload" aria-labelledby={`${id}-heading`}>
    <div className="mission-evidence-upload__heading"><h4 id={`${id}-heading`}>Minh chứng hiện trường</h4><small>Chọn tệp để tự tải lên · JPEG, PNG hoặc MP4</small></div>
    <label className="mission-upload-control" data-static-label>
      <input type="file" multiple accept="image/jpeg,image/png,video/mp4" disabled={disabled || working || loading}
        aria-label="Thêm ảnh hoặc video minh chứng" aria-describedby={`${id}-hint`}
        onChange={event => {
          const files = Array.from(event.currentTarget.files || []);
          event.currentTarget.value = '';
          if (running.current || disabled || loading) return;
          const signature = fileSignature;
          const seen = new Set(entries.map(row => signature(row.file)));
          const next: Entry[] = files.filter(file => { const value = signature(file); if (seen.has(value)) return false; seen.add(value); return true; })
            .map((file, index) => { const error = evidenceFileError(file); return { file, key: newCommandKey(), queuedAt: Date.now() + index, persisted: false, state: error ? 'failed' : 'pending', error: error || undefined }; });
          setSelectionNotice(next.length < files.length ? 'Tệp đã có trong danh sách được bỏ qua để tránh tải trùng.' : '');
          setEntries(current => [...current, ...next]);
          void send(next.filter(row => row.state === 'pending'));
        }} />
      <span className="mission-upload-control__button">Thêm ảnh hoặc video</span>
      <span className="mission-upload-control__name" id={`${id}-hint`}>Ảnh tối đa 10 MB · video tối đa 50 MB</span>
    </label>
    {selectionNotice && <p role="status">{selectionNotice}</p>}
    {restoredQueue && blocked && <p role="status">Đã khôi phục tệp chờ. Bấm “Thử lại” để tiếp tục; chưa có xác nhận lưu từ máy chủ.</p>}
    {loading && <p role="status">Đang kiểm tra tệp chờ…</p>}
    {storageWarning && (blocked || loading) && <p className="notice warning" role="alert">{storageWarning}</p>}
    {entries.length > 0 && <ul className="mission-upload-list" aria-live="polite">{shown.map(entry => <li key={entry.key}>
      <div><strong>{entry.file.name}</strong><small className={entry.state === 'failed' ? 'field-error' : ''}>
        {entry.state === 'saved' ? '✓ Đã tải lên' : entry.state === 'uploading' ? 'Đang tải lên…' : entry.state === 'pending' ? 'Đang chờ tải…' : entry.error}
      </small></div>
      {entry.state === 'failed' && <div className="mission-upload-list__actions">
        {!evidenceFileError(entry.file) && <button type="button" className="button secondary" disabled={disabled || working} onClick={() => void send([entry])}>Thử lại</button>}
        <button type="button" className="button secondary" disabled={disabled || working} onClick={() => {
          void (entry.persisted ? removePendingEvidence(entry.key) : Promise.resolve()).then(() => { if (mounted.current) setEntries(current => current.filter(row => row.key !== entry.key)); })
            .catch(() => setStorageWarning('Chưa bỏ được tệp chờ. Vui lòng thử lại.'));
        }}>Bỏ tệp lỗi</button>
      </div>}
    </li>)}</ul>}
    <ListNav page={page} count={shown.length} noun="tệp" hasNext={start + LIST_PAGE_SIZE < entries.length} onPrev={prevPage} onNext={() => setCursor(String(start + LIST_PAGE_SIZE))} loading={loading} />
    {entries.filter(row => row.state === 'failed' && !evidenceFileError(row.file)).length > 1 && <button type="button" className="button secondary" disabled={disabled || working} onClick={() => void send(entries.filter(row => row.state === 'failed' && !evidenceFileError(row.file)))}>Thử lại các tệp chưa lưu</button>}
    {blocked && entries.every(row => row.state === 'saved' || row.persisted) && <small className="muted">Tệp chờ được giữ trên thiết bị tối đa 30 phút, xóa khi tải xong hoặc đăng xuất. Có thể F5 rồi mở lại nhiệm vụ.</small>}
    {blocked && !working && <p className="field-error" role="alert">Có tệp chưa lưu lên máy chủ. Thử lại hoặc bỏ tệp lỗi trước khi cập nhật nhiệm vụ.</p>}
  </section>;
}
