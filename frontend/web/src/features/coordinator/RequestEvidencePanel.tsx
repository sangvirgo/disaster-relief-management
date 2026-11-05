import { useState } from 'react';
import { api } from '../../api/client';
import { label, timeLabel } from '../../i18n/labels';

type Evidence = {
  id: string;
  state: string;
  size_bytes: number;
  detected_mime?: string;
  created_at: string;
};

export function RequestEvidencePanel({ items }: { items: Evidence[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function getViewLink(evidenceId: string) {
    setBusyId(evidenceId);
    setErrors((current) => ({ ...current, [evidenceId]: '' }));
    try {
      const result = await api<{ url: string; expires_in: number }>('response', `/evidence/${evidenceId}/download`);
      setUrls((current) => ({ ...current, [evidenceId]: result.url }));
    } catch (cause) {
      setErrors((current) => ({
        ...current,
        [evidenceId]: cause instanceof Error ? cause.message : 'Không thể lấy liên kết xem minh chứng.',
      }));
    } finally {
      setBusyId('');
    }
  }

  if (items.length === 0) return null;
  return (
    <section className="request-evidence-panel">
      <h3>Minh chứng hiện trường ({items.length})</h3>
      <p>Liên kết xem được cấp theo quyền hồ sơ và chỉ có hiệu lực trong thời gian ngắn.</p>
      <div className="record-list">
        {items.map((item) => (
          <article className="candidate" key={item.id}>
            <strong>Tệp {item.id.slice(0, 8)}</strong>
            <p>
              {label(item.state)} · {timeLabel(item.created_at)} · {Math.ceil(item.size_bytes / 1024)} KB
              {item.detected_mime ? ` · ${item.detected_mime}` : ''}
            </p>
            <div className="action-grid">
              <button
                type="button"
                className="button secondary"
                disabled={busyId === item.id}
                onClick={() => void getViewLink(item.id)}
              >
                {busyId === item.id ? 'Đang lấy liên kết…' : 'Lấy liên kết xem'}
              </button>
              {urls[item.id] && (
                <a className="button secondary" href={urls[item.id]} target="_blank" rel="noopener noreferrer">
                  Mở tệp
                </a>
              )}
            </div>
            {errors[item.id] && <p className="notice error" role="alert">{errors[item.id]}</p>}
          </article>
        ))}
      </div>
    </section>
  );
}
