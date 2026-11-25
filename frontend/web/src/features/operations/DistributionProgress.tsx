import { formatQuantity } from '../../i18n/quantity';
import { label, timeLabel } from '../../i18n/labels';
import './distribution-progress.css';

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** Distribution status in the words of the next step, so the list reads as a work queue. */
export const distributionStatusLabels: Record<string, string> = {
  DRAFT: 'Chờ duyệt',
  APPROVED: 'Chờ xuất kho',
  DISPATCHED: 'Đang bàn giao',
  RECONCILED: 'Hoàn tất',
  CANCELLED: 'Đã hủy',
};
export const distributionStatusTone: Record<string, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  DRAFT: 'warning', APPROVED: 'info', DISPATCHED: 'info', RECONCILED: 'success', CANCELLED: 'neutral',
};

type StepState = 'done' | 'current' | 'todo' | 'cancelled';
const order = ['DRAFT', 'APPROVED', 'DISPATCHED', 'RECONCILED'];

function lineSettled(line: Row) {
  return Number(line.in_transit ?? 0) === 0 && Number(line.pending_loss_count ?? 0) === 0;
}

/**
 * Summary of a distribution slip: where it is in the four-step flow
 * (prepare → approve → dispatch → hand over), who has to act next, and the item lines.
 * Separation of duties mirrors the Logistics API rules; the backend remains the authority.
 */
export function DistributionProgress({ detail, userId, warehouseName, campaignName }: {
  detail: Row;
  userId: string;
  warehouseName: string;
  campaignName?: string;
}) {
  const status = text(detail.status);
  const lines = Array.isArray(detail.lines) ? (detail.lines as Row[]) : [];
  const cancelled = status === 'CANCELLED';
  const reached = cancelled ? -1 : order.indexOf(status);
  const who = (id: unknown) => (id && id === userId ? 'Bạn' : id ? 'Người khác' : '');
  const settled = lines.filter(lineSettled).length;
  const steps: { title: string; meta: string; state: StepState }[] = [
    { title: 'Lập phiếu', meta: [who(detail.preparer_user_id), detail.created_at ? timeLabel(detail.created_at) : ''].filter(Boolean).join(' · '), state: 'done' },
    { title: 'Duyệt và xuất kho',
      meta: reached >= 2 ? [who(detail.dispatch_actor_user_id), detail.dispatched_at ? timeLabel(detail.dispatched_at) : ''].filter(Boolean).join(' · ')
        : reached === 1 ? `Đã duyệt (${who(detail.approver_user_id)}), chờ xuất kho` : 'Người khác người lập',
      state: reached >= 2 ? 'done' : reached >= 0 ? 'current' : 'todo' },
    { title: 'Bàn giao', meta: reached >= 2 ? `${settled}/${lines.length} dòng đã xong` : 'Người khác người xuất kho', state: reached >= 3 ? 'done' : reached === 2 ? 'current' : 'todo' },
    { title: 'Hoàn tất', meta: detail.reconciled_at ? timeLabel(detail.reconciled_at) : 'Tự đối soát', state: reached >= 3 ? 'done' : 'todo' },
  ];
  if (cancelled) steps.forEach((step, index) => { if (index > 0) step.state = 'cancelled'; });

  const preparer = detail.preparer_user_id === userId;
  const dispatcher = detail.dispatch_actor_user_id === userId;
  const next = cancelled
    ? { tone: 'neutral', title: 'Phiếu đã hủy', body: 'Hàng chưa rời kho; số lượng đã giữ được trả lại tồn khả dụng.' }
    : status === 'DRAFT'
      ? preparer
        ? { tone: 'waiting', title: 'Đang chờ người khác duyệt và xuất kho', body: 'Bạn là người lập phiếu nên không tự duyệt được. Hãy nhờ một quản lý vận hành khác đối chiếu hàng và bấm “Duyệt và xuất kho”.' }
        : { tone: 'action', title: 'Bước tiếp theo: duyệt và xuất kho', body: 'Đối chiếu kho, vật phẩm và số lượng với hàng thực tế. Nếu khớp, bấm “Duyệt và xuất kho”; tồn kho bị trừ ngay.' }
      : status === 'APPROVED'
        ? { tone: 'action', title: 'Bước tiếp theo: xuất kho', body: 'Phiếu đã được duyệt. Quản lý vận hành đối chiếu hàng thực tế rồi bấm “Xác nhận xuất kho”.' }
        : status === 'DISPATCHED'
          ? dispatcher
            ? { tone: 'waiting', title: 'Đang chờ ghi nhận bàn giao', body: 'Bạn đã xuất kho nên không tự ghi nhận bàn giao được. Người lập phiếu hoặc một quản lý vận hành khác sẽ xác nhận khi hàng đã đến tay người nhận.' }
            : { tone: 'action', title: 'Bước tiếp theo: ghi nhận bàn giao', body: 'Khi hàng đã đến tay người nhận, bấm “Xác nhận đã giao đủ”. Nếu giao thiếu, hoàn kho hoặc thất thoát, dùng phần ghi nhận từng dòng.' }
          : { tone: 'done', title: 'Phiếu đã hoàn tất', body: 'Toàn bộ hàng đã có kết quả bàn giao và đã được đối soát.' };

  return <section className="distribution-progress" aria-label="Tiến trình phiếu phân phối">
    <dl className="distribution-progress__facts">
      <div><dt>Mục đích</dt><dd>{label(detail.purpose)}</dd></div>
      <div><dt>Kho xuất</dt><dd>{warehouseName}</dd></div>
      {campaignName && <div><dt>Chiến dịch</dt><dd>{campaignName}</dd></div>}
      <div><dt>Trạng thái</dt><dd>{distributionStatusLabels[status] || label(status)}</dd></div>
    </dl>
    <ol className="distribution-steps">
      {steps.map((step, index) => <li key={step.title} className={`distribution-step distribution-step--${step.state}`} aria-current={step.state === 'current' ? 'step' : undefined}>
        <span className="distribution-step__dot" aria-hidden="true">{step.state === 'done' ? '✓' : index + 1}</span>
        <span className="distribution-step__title">{step.title}</span>
        <span className="distribution-step__meta">{step.state === 'cancelled' ? 'Đã hủy' : step.meta}</span>
      </li>)}
    </ol>
    <div className={`distribution-next distribution-next--${next.tone}`} role="status">
      <strong>{next.title}</strong>
      <p>{next.body}</p>
    </div>
  </section>;
}

/** Item lines of a distribution slip; settlement columns appear once the goods have left the warehouse. */
export function DistributionLines({ detail, unitFor }: { detail: Row; unitFor: (line: Row) => string }) {
  const status = text(detail.status);
  const lines = Array.isArray(detail.lines) ? (detail.lines as Row[]) : [];
  const reached = status === 'CANCELLED' ? -1 : order.indexOf(status);
  return <section className="distribution-progress" aria-label="Vật phẩm trong phiếu">
    <h3 className="distribution-progress__lines-title">Vật phẩm trong phiếu</h3>
    {lines.length === 0 ? <p className="muted">Phiếu chưa có dòng vật phẩm.</p> :
      <div className="operations-table-scroll" role="region" aria-label="Bảng vật phẩm trong phiếu" tabIndex={0}>
        <table className="distribution-lines">
          <thead><tr>
            <th scope="col">Vật phẩm</th>
            <th scope="col" className="numeric">Số lượng</th>
            {reached >= 2 && <>
              <th scope="col" className="numeric">Đang vận chuyển</th>
              <th scope="col" className="numeric">Đã giao</th>
              <th scope="col" className="numeric">Hoàn kho</th>
              <th scope="col" className="numeric">Thất thoát</th>
            </>}
          </tr></thead>
          <tbody>{lines.map((line, index) => {
            const unit = unitFor(line);
            const q = (value: unknown) => `${formatQuantity(value ?? '0')} ${unit}`;
            return <tr key={text(line.id) || index}>
              <th scope="row">{text(line.item_name) || 'Vật phẩm'}{line.commitment_id ? <small>Theo cam kết hỗ trợ SOS</small> : null}</th>
              <td className="numeric">{q(line.quantity)}</td>
              {reached >= 2 && <>
                <td className="numeric">{Number(line.in_transit ?? 0) > 0 ? <strong>{q(line.in_transit)}</strong> : q(line.in_transit)}</td>
                <td className="numeric">{q(line.handed_out)}</td>
                <td className="numeric">{q(line.returned)}</td>
                <td className="numeric">{q(line.lost)}{Number(line.pending_loss_count) > 0 && <small>Chờ duyệt</small>}</td>
              </>}
            </tr>;
          })}</tbody>
        </table>
      </div>}
    <details className="distribution-progress__tech">
      <summary>Mã phiếu và phiên bản</summary>
      <p>Mã phiếu: <code>{text(detail.id)}</code> · Phiên bản: {String(detail.version ?? '—')}</p>
    </details>
  </section>;
}
