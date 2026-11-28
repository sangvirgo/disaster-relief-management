import { useEffect, useState } from 'react';
import { LIST_PAGE_SIZE, useCursorNav } from '../../api/useCursorNav';
import { ListNav } from '../../components/ui/Pager';
import type { CountEvidence } from './countEvidence';

export function CountEvidenceFiles({ entries, onRemove }: { entries: CountEvidence[]; onRemove: (key: string) => void }) {
  const [cursor, setCursor, prev, page] = useCursorNav<string>('');
  const start = Number(cursor || 0);
  useEffect(() => { if (start >= entries.length && start > 0) setCursor(''); }, [start, entries.length, setCursor]);
  if (!entries.length) return null;
  const shown = entries.slice(start, start + LIST_PAGE_SIZE);
  return <div>
    <ul className="count-evidence-files" aria-label="Minh chứng kiểm đếm đã chọn">
      {shown.map(entry => <li key={entry.key}>
        <LocalPreview file={entry.file} />
        <span className="count-evidence-files__name" title={entry.file.name}>{entry.file.name}</span>
        <small role="status">{entry.state === 'ready' ? 'Đã tải lên' : entry.state === 'uploading' ? 'Đang tải lên…' : entry.state === 'failed' ? 'Chưa tải lên được' : 'Chờ gửi'}</small>
        {entry.error && <small className="field-error" role="alert">{entry.error}</small>}
        {entry.state !== 'ready' && <button type="button" className="button secondary" disabled={entry.state === 'uploading'} onClick={() => onRemove(entry.key)} aria-label={`Bỏ tệp ${entry.file.name}`}>Bỏ tệp</button>}
      </li>)}
    </ul>
    <ListNav page={page} count={shown.length} noun="tệp" hasNext={start + LIST_PAGE_SIZE < entries.length} onPrev={prev} onNext={() => setCursor(String(start + LIST_PAGE_SIZE))} />
  </div>;
}

function LocalPreview({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  if (!url) return null;
  return file.type === 'video/mp4'
    ? <video src={url} controls preload="metadata" aria-label={`Xem trước ${file.name}`} />
    : <img src={url} alt={`Xem trước ${file.name}`} />;
}
