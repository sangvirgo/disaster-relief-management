import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { CommandForm } from '../../components/CommandForm';
import { RecoveryIssue } from '../../components/RecoveryIssue';
import { label, timeLabel } from '../../i18n/labels';

type ContactAttempt = {
  id: string;
  contact_target: string;
  outcome: string;
  note?: string | null;
  attempted_at?: string;
};
type ContactAttemptPage = {
  items: ContactAttempt[];
  more: boolean;
  cursor?: string;
};

const contactTargets = [
  { value: 'REPORTER', label: 'Người báo tin' },
  { value: 'BENEFICIARY', label: 'Người cần hỗ trợ' },
  { value: 'ALTERNATE', label: 'Người liên hệ thay thế' },
  { value: 'AUTHORITY', label: 'Cơ quan chức năng' },
];
const contactOutcomes = [
  { value: 'REACHED', label: 'Đã liên hệ được' },
  { value: 'NO_ANSWER', label: 'Không nghe máy' },
  { value: 'WRONG_NUMBER', label: 'Sai số liên hệ' },
  { value: 'OTHER', label: 'Kết quả khác' },
];

export function ContactAttemptPanel({
  requestId,
  status,
  version,
  initial,
  onSuccess,
  onStale,
}: {
  requestId: string;
  status: string;
  version: number;
  initial: ContactAttemptPage;
  onSuccess: () => void;
  onStale: () => void;
}) {
  const [attempts, setAttempts] = useState(initial.items);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(initial.more);
  const [cursorLoading, setCursorLoading] = useState(initial.more);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!initial.more) return;
    let live = true;
    api<ContactAttemptPage>('response', `/requests/${requestId}/contact-attempts`)
      .then((page) => {
        if (!live) return;
        setCursor(page.cursor ?? null);
        setMore(page.more);
        setAttempts((current) => {
          const known = new Set(current.map((item) => item.id));
          return [...current, ...page.items.filter((item) => !known.has(item.id))];
        });
      })
      .catch((cause) => {
        if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải lịch sử liên hệ.');
      })
      .finally(() => {
        if (live) setCursorLoading(false);
      });
    return () => { live = false; };
  }, [initial.more, requestId]);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ cursor });
      const page = await api<ContactAttemptPage>(
        'response',
        `/requests/${requestId}/contact-attempts?${query.toString()}`
      );
      setAttempts((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !known.has(item.id))];
      });
      setCursor(page.cursor ?? null);
      setMore(page.more);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải lịch sử liên hệ.');
    } finally {
      setLoading(false);
    }
  }

  const eligibleContacts = attempts.filter(
    (item) => item.outcome === 'REACHED' && ['REPORTER', 'ALTERNATE'].includes(item.contact_target)
  );
  if (status !== 'VERIFYING' && attempts.length === 0 && !more) return null;

  return (
    <section className="contact-attempt-panel">
      {status === 'VERIFYING' && (
        <>
          <h3>Ghi nhận lần liên hệ xác minh</h3>
          <p>Ghi lại người đã liên hệ và kết quả. Hệ thống lưu điều phối viên thực hiện vào lịch sử.</p>
          <CommandForm
            key={`contact-attempt-${requestId}-${version}`}
            spec={{
              title: 'Thêm lần liên hệ',
              service: 'response',
              path: `/requests/${requestId}/contact-attempts`,
              fields: [
                { name: 'contact_target', label: 'Đối tượng liên hệ', type: 'select', required: true, options: contactTargets },
                { name: 'outcome', label: 'Kết quả liên hệ', type: 'select', required: true, options: contactOutcomes },
                { name: 'note', label: 'Ghi chú', type: 'textarea', maxLength: 1000 },
              ],
            }}
            onSuccess={onSuccess}
            onStale={onStale}
          />
        </>
      )}

      {attempts.length > 0 ? (
        <>
          <h3>Lịch sử liên hệ ({attempts.length}{more ? '+' : ''})</h3>
          <div className="record-list">
            {attempts.map((attempt) => (
              <article className="candidate" key={attempt.id}>
                <strong>
                  {contactTargets.find((item) => item.value === attempt.contact_target)?.label ?? label(attempt.contact_target)}
                  {' · '}
                  {contactOutcomes.find((item) => item.value === attempt.outcome)?.label ?? label(attempt.outcome)}
                </strong>
                {attempt.attempted_at && <p>{timeLabel(attempt.attempted_at)}</p>}
                {attempt.note && <p>{attempt.note}</p>}
              </article>
            ))}
          </div>
        </>
      ) : status !== 'VERIFYING' ? (
        <p className="muted">Chưa ghi nhận lần liên hệ nào.</p>
      ) : null}

      {more && (
        <button type="button" className="button secondary" onClick={() => void loadMore()} disabled={loading || cursorLoading || !cursor}>
          {cursorLoading ? 'Đang chuẩn bị lịch sử…' : loading ? 'Đang tải lịch sử…' : 'Tải các lần liên hệ cũ hơn'}
        </button>
      )}
      {more && !cursor && !cursorLoading && !error && (
        <p className="notice warning">Chưa nhận được mã trang tiếp theo. Hãy tải lại hồ sơ để xem lịch sử đầy đủ.</p>
      )}
      {error && <p className="notice error" role="alert">{error}</p>}

      {eligibleContacts.length > 0 && (
        <details className="secondary-command">
          <summary>Cấp mã khôi phục</summary>
          <RecoveryIssue
            key={`recovery-${requestId}-${version}-${eligibleContacts.length}`}
            service="response"
            path={`/requests/${requestId}/recovery`}
            version={version}
            kind="sos"
            contacts={attempts}
          />
        </details>
      )}
    </section>
  );
}
