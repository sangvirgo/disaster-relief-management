import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { CommandForm } from '../../components/CommandForm';
import { RecoveryIssue } from '../../components/RecoveryIssue';
import { label, timeLabel } from '../../i18n/labels';

type ContactAttempt = {
  id: string;
  contact_target: string;
  outcome: string;
  actor_user_id?: string | null;
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
  currentUserId,
  reporterUserId,
  initial,
  onSuccess,
  onStale,
}: {
  requestId: string;
  status: string;
  version: number;
  currentUserId: string;
  reporterUserId?: string | null;
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

  const canRecover = !reporterUserId && !['REJECTED', 'DUPLICATE', 'RESOLVED', 'CLOSED', 'CANCELLED'].includes(status);
  const eligibleContacts = attempts.filter(
    (item) => item.outcome === 'REACHED' && item.contact_target === 'REPORTER'
      && item.actor_user_id !== currentUserId
  );
  if ((!canRecover || status !== 'VERIFYING') && attempts.length === 0 && !more) return null;

  return (
    <section className="contact-attempt-panel">
      <details className="secondary-command">
        <summary>{canRecover ? 'Khôi phục mã theo dõi SOS' : 'Lịch sử liên hệ'}</summary>
      {canRecover && status === 'VERIFYING' && (
        <>
          <p>Chỉ ghi nhận liên hệ khi cần cấp lại mã theo dõi. Điều phối viên cấp mã phải khác người đã liên hệ.</p>
          <CommandForm
            key={`contact-attempt-${requestId}-${version}`}
            spec={{
              title: 'Ghi nhận liên hệ cho khôi phục mã',
              service: 'response',
              path: `/requests/${requestId}/contact-attempts`,
              fields: [
                { name: 'contact_target', label: 'Đối tượng liên hệ', type: 'select', required: true, options: contactTargets.filter((target) => target.value === 'REPORTER') },
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

      {canRecover && eligibleContacts.length > 0 && (
        <div className="recovery-issue-panel">
          <RecoveryIssue
            key={`recovery-${requestId}-${version}-${eligibleContacts.length}`}
            service="response"
            path={`/requests/${requestId}/recovery`}
            version={version}
            kind="sos"
            contacts={attempts}
            currentUserId={currentUserId}
          />
        </div>
      )}
      </details>
    </section>
  );
}
