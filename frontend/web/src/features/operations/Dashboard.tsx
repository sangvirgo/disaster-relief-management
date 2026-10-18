import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { label, timeLabel } from '../../i18n/labels';

type ResponseSummary = { status_counts: Record<string, number>; priority_counts: Record<string, number>; active_missions: number; overdue_missions: number; generated_at: string };
type Stock = { items: { warehouse_id: string; item: { name: string }; unit: { display_name: string }; on_hand: string; reserved: string; available: string }[]; generated_at?: string; more?: boolean };
export function OperationsDashboard() {
  const [response, setResponse] = useState<ResponseSummary | null>(null); const [stock, setStock] = useState<Stock | null>(null);
  const [responseError, setResponseError] = useState(''); const [stockError, setStockError] = useState('');
  useEffect(() => { let live = true; const from = new Date(Date.now() - 7 * 86_400_000).toISOString(); const to = new Date().toISOString();
    api<ResponseSummary>('response', `/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then((value) => { if (live) setResponse(value); }).catch((cause) => { if (live) setResponseError(cause instanceof Error ? cause.message : 'Không thể tải tình hình ứng cứu.'); });
    api<Stock>('logistics', '/reports/stock-summary?limit=10')
      .then((value) => { if (live) setStock(value); }).catch((cause) => { if (live) setStockError(cause instanceof Error ? cause.message : 'Không thể tải tình hình kho.'); });
    return () => { live = false; }; }, []);
  return <div className="grid-two"><section className="card"><h2>Ứng cứu trong 7 ngày</h2><p>Dữ liệu từ dịch vụ Response, chỉ trong phạm vi bạn được cấp quyền.</p>
    {!response && !responseError && <p role="status">Đang tải tình hình ứng cứu…</p>}{responseError && <p className="notice error" role="alert">{responseError}</p>}
    {response && <><p className="muted">Tạo lúc {timeLabel(response.generated_at)}</p><div className="detail-grid"><p><strong>Nhiệm vụ đang hoạt động</strong><br />{response.active_missions}</p><p><strong>Nhiệm vụ quá hạn</strong><br />{response.overdue_missions}</p></div>
      <h3>Yêu cầu theo trạng thái</h3>{Object.entries(response.status_counts).length ? Object.entries(response.status_counts).map(([status, count]) => <p key={status}>{label(status)}: <strong>{count}</strong></p>) : <p>Chưa có yêu cầu trong khoảng thời gian này.</p>}
      <h3>Mức ưu tiên đã quyết định</h3>{Object.entries(response.priority_counts).map(([priority, count]) => <p key={priority}>{priority}: <strong>{count}</strong></p>)}</>}
    </section><section className="card"><h2>Tình hình tồn kho</h2><p>Mỗi vật phẩm giữ nguyên đơn vị; không cộng số lượng khác đơn vị.</p>
    {!stock && !stockError && <p role="status">Đang tải tình hình kho…</p>}{stockError && <p className="notice error" role="alert">{stockError}</p>}
    {stock && <>{stock.generated_at && <p className="muted">Tạo lúc {timeLabel(stock.generated_at)}</p>}
      {stock.items.length ? <div className="record-list">{stock.items.map((item, index) => <div className="record" key={`${item.warehouse_id}:${item.item.name}:${index}`}><div><strong>{item.item.name}</strong><small>{item.unit.display_name} · Kho {item.warehouse_id.slice(0, 8)}</small></div><span>Khả dụng: <strong>{item.available}</strong> · Tồn: {item.on_hand} · Đã giữ: {item.reserved}</span></div>)}</div> : <div className="empty">Chưa có tồn kho trong phạm vi này.</div>}
      {stock.more && <p className="muted">Đang hiển thị 10 dòng đầu. Mở trang Tồn kho để xem thêm.</p>}</>}
    </section></div>;
}
