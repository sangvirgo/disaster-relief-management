import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { CommandForm } from '../../components/CommandForm';
import { formatQuantity } from '../../i18n/quantity';
import { timeLabel } from '../../i18n/labels';

type Handoff = {
  id: string; handoff_kind: string; status: string; recorder_user_id: string;
  confirmation_basis: string; occurred_at: string; receiver_label?: string;
  review?: { decision: string; reason: string } | null;
  lines: { distribution_line_id: string; quantity: string; unit_code: string }[];
};
const kinds: Record<string, string> = { LOSS: 'Báo cáo thất thoát', RETURN: 'Hoàn về kho', POINT_RECEIPT: 'Điểm cứu trợ nhận hàng', HOUSEHOLD_HANDOUT: 'Giao cho hộ dân tại điểm', DIRECT_HOUSEHOLD: 'Giao trực tiếp cho hộ dân' };
const statuses: Record<string, string> = { PENDING_LOSS: 'Chờ duyệt thất thoát', APPROVED: 'Đã duyệt thất thoát', REJECTED: 'Đã từ chối thất thoát', RECORDED: 'Đã ghi nhận' };
export function HandoffDetail({ distributionId, initialId, canReview, userId, onChanged }: {
  distributionId: string; initialId?: string; canReview: boolean; userId: string; onChanged: () => void;
}) {
  const storageKey = `c48.handoff-view.${userId}.${distributionId}`;
  function restoredId() { try { return initialId || sessionStorage.getItem(storageKey) || ''; } catch { return initialId || ''; } }
  const [lookup, setLookup] = useState(restoredId);
  const [id, setId] = useState(restoredId);
  const [detail, setDetail] = useState<Handoff | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!id) { setDetail(null); setBusy(false); return; }
    let live = true; setBusy(true); setError(''); setDetail(null);
    api<Handoff>('logistics', `/distributions/${distributionId}/handoffs/${id}`)
      .then((value) => { if (live) {
        setDetail(value);
        try { sessionStorage.setItem(storageKey, value.id); } catch { /* Optional view persistence. */ }
      } })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Không thể tải bản ghi bàn giao.'); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [distributionId, id, revision, storageKey]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lookup.trim())) { setError('Nhập mã bản ghi bàn giao hợp lệ.'); return; }
    setId(lookup.trim()); setRevision((value) => value + 1);
  }
  return <section className="form-stack">
    <h3>Tra cứu bàn giao và thất thoát</h3>
    <p>Nhập mã bản ghi do người ghi nhận cung cấp. Mã này được hiển thị sau khi ghi nhận thành công.</p>
    {initialId && <p role="status">Đã ghi nhận. Mã bản ghi để tra cứu hoặc chuyển người duyệt: <strong>{initialId}</strong></p>}
    <form className="form-stack" onSubmit={submit}>
      <label>Mã bản ghi bàn giao<input value={lookup} onChange={(event) => {
        const value = event.target.value;
        setLookup(value); setError('');
        if (value.trim().toLowerCase() !== id.toLowerCase()) {
          setId(''); setDetail(null); setBusy(false);
          try { sessionStorage.removeItem(storageKey); } catch { /* Optional view persistence. */ }
        }
      }} /></label>
      <button className="button secondary" disabled={busy}>{busy ? 'Đang tải…' : 'Xem bản ghi bàn giao'}</button>
    </form>
    {error && <p role="alert" className="notice error">{error}</p>}
    {detail && <>
      <h4>{kinds[detail.handoff_kind] || 'Bản ghi bàn giao'} · {statuses[detail.status] || 'Đã ghi nhận'}</h4>
      <p>{timeLabel(detail.occurred_at)} · {detail.confirmation_basis}</p>
      {detail.receiver_label && <p>Người nhận: {detail.receiver_label}</p>}
      <p>Số lượng: {detail.lines.map((line) => formatQuantity(line.quantity) + ' ' + ({ CAI: 'cái', KG: 'kg', LIT: 'lít', THUNG: 'thùng', BO: 'bộ', GOI: 'gói' }[line.unit_code] || line.unit_code)).join('; ')}</p>
      {detail.review && <p>Lý do quyết định: {detail.review.reason}</p>}
      {detail.status === 'PENDING_LOSS' && <p className="notice">Thất thoát chưa làm giảm số hàng đang giữ cho đến khi được người khác duyệt.</p>}
      {detail.status === 'PENDING_LOSS' && canReview && detail.recorder_user_id !== userId && <CommandForm key={detail.id + revision} spec={{
        title: 'Duyệt báo cáo thất thoát', service: 'logistics', path: `/distributions/${distributionId}/handoffs/${detail.id}/review-loss`, version: 1,
        fields: [{ name: 'decision', label: 'Quyết định', type: 'select', required: true, options: [{value:'APPROVE', label:'Chấp nhận thất thoát'}, {value:'REJECT', label:'Từ chối báo cáo'}] }, {name:'reason', label:'Lý do quyết định', type:'textarea', required:true, maxLength:1000}],
        warning: 'Xác nhận quyết định độc lập? Chấp nhận thất thoát sẽ cập nhật số lượng đối soát.',
      }} onSuccess={() => { setRevision((value) => value + 1); onChanged(); }} onStale={() => { setRevision((value) => value + 1); onChanged(); }} />}
    </>}
  </section>;
}
