import { useEffect, useState } from 'react';
import { LIST_PAGE_SIZE, useCursorNav } from '../../api/useCursorNav';
import { ListNav } from '../../components/ui/Pager';
import { label, requestStatusLabel, timeLabel } from '../../i18n/labels';
import { rescueProgressMessage, type RescueProgress } from './rescueProgress';
import { requestStatusTone } from './CitizenAccount';

type Event = { event_type: string; public_text_code?: string | null; occurred_at: string };
type Tracking = {
  tracking_code: string; status: string; received_at: string; timeline: Event[];
  current_description?: string | null; rejection_reason?: string; duplicate_of_code?: string; rescue_progress?: RescueProgress;
};

const STEPS: Array<{ title: string; statuses: string[] }> = [
  { title: 'Đã tiếp nhận', statuses: ['SUBMITTED'] },
  { title: 'Đang xác minh', statuses: ['VERIFYING'] },
  { title: 'Đã xác minh', statuses: ['VERIFIED', 'TRIAGED'] },
  { title: 'Đội cứu hộ', statuses: ['DISPATCHED', 'IN_PROGRESS', 'RESOLVING'] },
  { title: 'Hoàn tất', statuses: ['RESOLVED', 'CLOSED'] },
];
const STOPPED = ['REJECTED', 'DUPLICATE', 'CANCELLED'];

/** What the reporter can expect next, in plain words; never a promise of time or outcome. */
const NEXT_STEP: Record<string, string> = {
  SUBMITTED: 'Điều phối viên sẽ liên hệ để xác minh. Hãy giữ điện thoại mở và ở nơi an toàn nếu có thể.',
  VERIFYING: 'Điều phối viên đang kiểm tra thông tin. Nếu được gọi, hãy cho biết vị trí và số người cần hỗ trợ.',
  VERIFIED: 'Thông tin đã được xác minh. Điều phối viên đang chọn đội cứu hộ phù hợp.',
  TRIAGED: 'Yêu cầu đã được xếp mức ưu tiên và đang chờ giao đội cứu hộ.',
  DISPATCHED: 'Đã có đội cứu hộ được giao. Đội sẽ liên hệ hoặc đến vị trí đã báo.',
  IN_PROGRESS: 'Đội cứu hộ đang xử lý. Làm theo hướng dẫn của đội khi gặp.',
  RESOLVING: 'Nhiệm vụ sắp kết thúc, điều phối viên đang xác nhận kết quả.',
  RESOLVED: 'Yêu cầu đã được giải quyết. Nếu tình hình xấu đi, hãy gửi SOS mới.',
  CLOSED: 'Hồ sơ đã đóng. Nếu cần hỗ trợ thêm, hãy gửi SOS mới.',
  CANCELLED: 'Yêu cầu đã được hủy.',
};

export function TrackingProgress({ data, onBack }: { data: Tracking; onBack?: () => void }) {
  const [copied, setCopied] = useState(false);
  const stopped = STOPPED.includes(data.status);
  const current = STEPS.findIndex((step) => step.statuses.includes(data.status));
  const progress = rescueProgressMessage(data.status, data.rescue_progress);
  const nextStep = progress ? (data.rescue_progress!.active > 0
    ? 'Làm theo hướng dẫn của đội khi gặp. Nếu tình huống thay đổi, hãy bổ sung thông tin.'
    : 'Điều phối viên đang đối chiếu kết quả trước khi kết thúc SOS.') : NEXT_STEP[data.status];
  const events = [...data.timeline].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  const [cursor, setCursor, prev, page] = useCursorNav<string>('');
  useEffect(() => { setCursor(''); }, [data.tracking_code, setCursor]);
  const offset = Number(cursor || 0);
  const visibleEvents = events.slice(offset, offset + LIST_PAGE_SIZE);
  async function copy() {
    try { await navigator.clipboard.writeText(data.tracking_code); setCopied(true); window.setTimeout(() => setCopied(false), 2000); }
    catch { setCopied(false); }
  }
  return <section className="card tracking-progress-card tracking-page">
    {onBack && <button className="tracking-back" type="button" onClick={onBack}><span aria-hidden="true">←</span> Quay lại danh sách</button>}
    <header className="tracking-head">
      <div>
        <span className="eyebrow">Mã theo dõi SOS</span>
        <h2 className="tracking-head__code">{data.tracking_code}
          <button type="button" className="tracking-copy" onClick={() => void copy()} aria-label="Sao chép mã theo dõi">{copied ? 'Đã sao chép' : 'Sao chép'}</button>
        </h2>
        <p className="muted">Tiếp nhận lúc {timeLabel(data.received_at)}</p>
      </div>
      <span className={`chip request-status request-status--${requestStatusTone(data.status)}`}>{requestStatusLabel(data.status)}</span>
    </header>

    {!stopped && <ol className="tracking-steps" aria-label="Các bước xử lý">
      {STEPS.map((step, index) => <li key={step.title} className={index < current ? 'is-done' : index === current ? 'is-current' : ''}
        aria-current={index === current ? 'step' : undefined}>
        <span className="tracking-steps__dot" aria-hidden="true">{index < current ? '✓' : index + 1}</span>
        <span>{step.title}</span>
      </li>)}
    </ol>}

    {(progress || NEXT_STEP[data.status]) && <div className="tracking-next" role="status">
      <strong>{progress ?? 'Bước tiếp theo'}</strong>
      {nextStep && <p>{nextStep}</p>}
    </div>}
    {data.status === 'DUPLICATE' && data.duplicate_of_code && <p className="notice">Yêu cầu này trùng với hồ sơ {data.duplicate_of_code}. Nếu hồ sơ gốc thuộc tài khoản của bạn, hãy quay lại danh sách để xem tiến độ hồ sơ đó.</p>}
    {data.status === 'REJECTED' && data.rejection_reason && <p className="notice">Lý do từ chối: {data.rejection_reason}</p>}

    <div className="tracking-columns">
      {data.current_description && <div className="tracking-situation">
        <h3>Tình huống đang ghi nhận</h3>
        {data.current_description.split(/(?=Cập nhật\s*:)/iu).map((part, index) => {
          const update = part.match(/^(Cập nhật\s*:)([\s\S]*)$/iu);
          return <p key={index}>{update ? <><strong>Cập nhật:</strong>{update[2]}</> : part}</p>;
        })}
      </div>}
      <div className="tracking-history">
        <h3>Lịch sử xử lý</h3>
        <ol className="timeline tracking-history__list">
          {visibleEvents.map((entry, index) => <li className={`timeline-item${offset + index === 0 ? ' is-latest' : ''}`} key={`${entry.occurred_at}-${index}`}>
            <strong>{label(entry.public_text_code || entry.event_type)}</strong>
            <small>{timeLabel(entry.occurred_at)}</small>
          </li>)}
        </ol>
        <ListNav page={page} count={visibleEvents.length} hasNext={offset + LIST_PAGE_SIZE < events.length}
          onPrev={prev} onNext={() => setCursor(String(offset + LIST_PAGE_SIZE))} noun="mốc xử lý" />
      </div>
    </div>
    <p className="tracking-hotline">Nguy hiểm đến tính mạng? Gọi ngay <a href="tel:114">114</a> (cứu hỏa, cứu nạn) hoặc <a href="tel:115">115</a> (cấp cứu).</p>
  </section>;
}
