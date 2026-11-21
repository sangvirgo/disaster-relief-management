import { useRef, useState, type FormEvent } from 'react';
import { api, newCommandKey, upload } from '../../api/client';
import { SelectedFiles } from '../../components/ui/SelectedFiles';
import { evidenceFileError } from '../../i18n/evidence';

type Uploaded = { id: string; name: string };

/** Lets warehouse staff and reviewers attach counting evidence (photo or video) to a donation delivery. */
export function ReceiptEvidenceUpload({ deliveryId }: { deliveryId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const key = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [uploaded, setUploaded] = useState<Uploaded[]>([]);
  const [link, setLink] = useState<{ id: string; url: string } | null>(null);
  const fileError = file ? evidenceFileError(file) : null;

  function reset() {
    setFile(null);
    key.current = null;
    if (input.current) input.current.value = '';
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || fileError) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      key.current ||= newCommandKey();
      const result = await upload<{ id: string; state: string }>(
        'logistics', `/public/donations/${encodeURIComponent(deliveryId)}/evidence`, file, { idempotencyKey: key.current },
      );
      if (result.state === 'READY') setUploaded((current) => [...current.filter((item) => item.id !== result.id), { id: result.id, name: file.name }]);
      setMessage('Đã tải minh chứng kiểm đếm lên.');
      reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa tải được minh chứng.');
    } finally {
      setBusy(false);
    }
  }

  async function open(id: string) {
    setError('');
    try {
      const result = await api<{ url: string }>('logistics', `/evidence/${encodeURIComponent(id)}/download`);
      setLink({ id, url: result.url });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chưa lấy được liên kết mở tệp.');
    }
  }

  return (
    <form className="form-stack command-form" onSubmit={submit} noValidate>
      <h3>Minh chứng kiểm đếm</h3>
      <p>Tải ảnh (JPEG, PNG) hoặc video MP4 chụp hàng thực tế để người duyệt đối chiếu.</p>
      <label>
        <span>Tệp minh chứng</span>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,video/mp4"
          aria-invalid={Boolean(fileError)}
          onChange={(event) => { setFile(event.target.files?.[0] || null); key.current = null; setMessage(''); }}
        />
      </label>
      <SelectedFiles files={file ? [file] : []} onRemove={reset} />
      {fileError && <small className="field-error" role="alert">{fileError}</small>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice" role="status">{message}</p>}
      <button className="button secondary" disabled={busy || !file || Boolean(fileError)}>{busy ? 'Đang tải lên…' : 'Tải minh chứng lên'}</button>
      {uploaded.map((item) => (
        <div key={item.id}>
          <span style={{ overflowWrap: 'anywhere' }}>{item.name}</span>{' '}
          <button type="button" className="button secondary" onClick={() => void open(item.id)}>Lấy liên kết mở tệp</button>
          {link?.id === item.id && <> <a href={link.url} target="_blank" rel="noopener noreferrer">Mở tệp trong tab mới</a></>}
        </div>
      ))}
    </form>
  );
}
