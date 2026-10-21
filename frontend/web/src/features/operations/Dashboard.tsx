import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { label, timeLabel } from '../../i18n/labels';
import { AnalyticsRegionField, useAnalyticsRegion } from '../../components/AnalyticsRegion';

type ResponseSummary = {
  status_counts: Record<string, number>;
  priority_counts: Record<string, number>;
  active_missions: number;
  overdue_missions: number;
  generated_at: string;
};
type Stock = {
  items: {
    warehouse_id: string;
    item: { name: string };
    unit: { display_name: string };
    on_hand: string;
    reserved: string;
    available: string;
  }[];
  generated_at?: string;
  more?: boolean;
};
export function OperationsDashboard() {
  const { region, setRegion, regions, loading: regionLoading, error: regionError } = useAnalyticsRegion();
  const [response, setResponse] = useState<ResponseSummary | null>(null);
  const [stock, setStock] = useState<Stock | null>(null);
  const [responseError, setResponseError] = useState('');
  const [stockError, setStockError] = useState('');
  useEffect(() => {
    if (!region) return;
    let live = true;
    setResponse(null);
    setResponseError('');
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const to = new Date().toISOString();
    api<ResponseSummary>(
      'response',
      `/reports/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&region_code=${encodeURIComponent(region)}`
    )
      .then((value) => {
        if (live) setResponse(value);
      })
      .catch((cause) => {
        if (live)
          setResponseError(
            cause instanceof Error ? cause.message : 'Không thể tải tình hình ứng cứu.'
          );
      });
    return () => {
      live = false;
    };
  }, [region]);
  useEffect(() => {
    let live = true;
    api<Stock>('logistics', '/reports/stock-summary?limit=10')
      .then((value) => {
        if (live) setStock(value);
      })
      .catch((cause) => {
        if (live)
          setStockError(cause instanceof Error ? cause.message : 'Không thể tải tình hình kho.');
      });
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="operations-dashboard">
      <section className="card report-card">
        <div className="section-header"><div><span className="eyebrow">Tổng quan ứng cứu</span><h2>Ứng cứu trong 7 ngày</h2></div><span className="report-period">Theo khu vực</span></div>
        <AnalyticsRegionField region={region} onChange={setRegion} regions={regions} />
        {regionError && <p className="notice error" role="alert">{regionError}</p>}
        {!region && !regionLoading && <p>Chọn hoặc nhập mã khu vực để xem tình hình ứng cứu.</p>}
        {region && !response && !responseError && <p role="status">Đang tải tình hình ứng cứu…</p>}
        {responseError && (
          <p className="notice error" role="alert">
            {responseError}
          </p>
        )}
        {response && (
          <>
            <p className="muted">Tạo lúc {timeLabel(response.generated_at)}</p>
            <div className="report-metrics">
              <div className="metric-tile"><span>Nhiệm vụ đang hoạt động</span><strong>{response.active_missions}</strong><small>Đội đang thực hiện</small></div>
              <div className="metric-tile metric-tile-warning"><span>Nhiệm vụ quá hạn</span><strong>{response.overdue_missions}</strong><small>Cần theo dõi</small></div>
              <div className="metric-tile metric-tile-green"><span>Tổng yêu cầu</span><strong>{Object.values(response.status_counts).reduce((sum, count) => sum + count, 0)}</strong><small>Trong 7 ngày</small></div>
            </div>
            <h3>Yêu cầu theo trạng thái</h3>
            {Object.entries(response.status_counts).length ? (
              <div className="report-status-grid">{Object.entries(response.status_counts).map(([status, count]) => (
                <div className="report-status" key={status}><span>{label(status)}</span><strong>{count}</strong></div>
              ))}</div>
            ) : (
              <p>Chưa có yêu cầu trong khoảng thời gian này.</p>
            )}
            <h3>Mức ưu tiên đã quyết định</h3>
            <div className="report-status-grid">{Object.entries(response.priority_counts).map(([priority, count]) => (
              <div className="report-status" key={priority}><span>{label(priority)}</span><strong>{count}</strong></div>
            ))}</div>
          </>
        )}
      </section>
      <section className="card stock-panel">
        <div className="section-header"><div><span className="eyebrow">Vật tư cứu trợ</span><h2>Tình hình tồn kho</h2></div><span className="report-period">Theo từng kho và đơn vị</span></div>
        <p>Mỗi dòng giữ nguyên đơn vị của vật phẩm. Khả dụng là số còn có thể phân bổ.</p>
        <p className="table-swipe-hint">Vuốt ngang bảng để xem các cột số lượng.</p>
        {!stock && !stockError && <p role="status">Đang tải tình hình kho…</p>}
        {stockError && (
          <p className="notice error" role="alert">
            {stockError}
          </p>
        )}
        {stock && (
          <>
            {stock.generated_at && <p className="muted">Tạo lúc {timeLabel(stock.generated_at)}</p>}
            {stock.items.length ? (
              <div className="stock-table-scroll">
                <table className="stock-table">
                  <thead><tr><th>Vật phẩm</th><th>Kho</th><th>Đơn vị</th><th className="numeric">Tồn thực tế</th><th className="numeric">Đã giữ</th><th className="numeric">Khả dụng</th></tr></thead>
                  <tbody>{stock.items.map((item, index) => (
                    <tr key={`${item.warehouse_id}:${item.item.name}:${index}`}><th scope="row">{item.item.name}</th><td>{item.warehouse_id.slice(0, 8)}</td><td>{item.unit.display_name}</td><td className="numeric">{item.on_hand}</td><td className="numeric">{item.reserved}</td><td className="numeric"><strong className="available-value">{item.available}</strong></td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : (
              <div className="empty">Chưa có tồn kho trong phạm vi này.</div>
            )}
            {stock.more && (
              <p className="muted">Đang hiển thị 10 dòng đầu. Mở trang Tồn kho để xem thêm.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
