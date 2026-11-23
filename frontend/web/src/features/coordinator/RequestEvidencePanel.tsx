import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { timeLabel } from '../../i18n/labels';

type Evidence = {
  id: string;
  state: string;
  size_bytes: number;
  detected_mime?: string;
  created_at: string;
};

export function RequestEvidencePanel({ items }: { items: Evidence[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.all(items.filter((item) => item.state === 'READY').map(async (item) => {
      try {
        const result = await api<{ url: string }>('response', `/evidence/${item.id}/download`);
        if (active) setUrls((current) => ({ ...current, [item.id]: result.url }));
      } catch (cause) {
        if (active) setErrors((current) => ({ ...current, [item.id]:
          cause instanceof Error ? cause.message : 'Không tải được minh chứng hiện trường.' }));
      }
    }));
    return () => { active = false; };
  }, [items]);

  async function retry(evidenceId: string) {
    setBusyId(evidenceId);
    setErrors((current) => ({ ...current, [evidenceId]: '' }));
    try {
      const result = await api<{ url: string }>('response', `/evidence/${evidenceId}/download`);
      setUrls((current) => ({ ...current, [evidenceId]: result.url }));
    } catch (cause) {
      setErrors((current) => ({ ...current, [evidenceId]:
        cause instanceof Error ? cause.message : 'Không tải được minh chứng hiện trường.' }));
    } finally {
      setBusyId('');
    }
  }

  if (items.length === 0) return null;
  return (
    <section className="request-evidence-panel" aria-label="Ảnh và video hiện trường">
      <h3>Ảnh và video hiện trường ({items.length})</h3>
      <div className="request-evidence-panel__gallery">
        {items.map((item) => (
          <div className="request-evidence-panel__item" key={item.id}>
            {urls[item.id] && item.detected_mime?.startsWith('image/') &&
              <a href={urls[item.id]} target="_blank" rel="noopener noreferrer" aria-label="Xem ảnh hiện trường cỡ lớn">
                <img src={urls[item.id]} alt="Ảnh hiện trường của SOS" loading="lazy" onError={() => {
                  setUrls((current) => ({ ...current, [item.id]: '' }));
                  setErrors((current) => ({ ...current, [item.id]: 'Không mở được ảnh. Hãy thử tải lại.' }));
                }} />
              </a>}
            {urls[item.id] && item.detected_mime?.startsWith('video/') &&
              <video src={urls[item.id]} controls preload="metadata" aria-label="Video hiện trường của SOS" />}
            {urls[item.id] && !item.detected_mime?.startsWith('image/') && !item.detected_mime?.startsWith('video/') &&
              <a className="button secondary" href={urls[item.id]} target="_blank" rel="noopener noreferrer">Mở minh chứng</a>}
            <small>{timeLabel(item.created_at)} · {Math.ceil(item.size_bytes / 1024)} KB</small>
            {!urls[item.id] && !errors[item.id] && <span role="status">Đang tải minh chứng…</span>}
            {errors[item.id] && <div className="request-evidence-panel__error">
              <p className="notice error" role="alert">{errors[item.id]}</p>
              <button type="button" className="button secondary" disabled={busyId === item.id} onClick={() => void retry(item.id)}>
                {busyId === item.id ? 'Đang tải…' : 'Thử tải lại'}
              </button>
            </div>}
          </div>
        ))}
      </div>
    </section>
  );
}
