import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { label, requestStatusLabel, timeLabel } from '../../i18n/labels';
import { OperationsDashboard } from '../operations/Dashboard';
import './role-dashboard.css';

type Counts = Record<string, number>;
type ResponseOverview = {
  requests: { open_total: number; open_by_status: Counts; open_by_priority: Counts; open_by_category: Counts;
    open_by_region: Counts; received_last_24h: number; resolved_total: number; verification_overdue: number;
    declared_danger_waiting: number; awaiting_team_assignment: number };
  missions: { active_by_status: Counts; overdue_offers: number };
  teams: { total: number; available: number; unavailable: number; awaiting_readiness: number;
    on_mission: number; position_missing_or_stale: number };
  thresholds: { verification_overdue_minutes: number; offer_overdue_minutes: number; team_position_fresh_minutes: number };
  recent_open_requests: { id: string; status: string; priority: string | null; region_code: string | null;
    category: string; received_at: string }[];
  generated_at: string;
};
type OperationsOverview = {
  intake?: { deliveries_by_status: Counts; awaiting_count_or_review: number; pending_review: number;
    open_disputes: number; drives_by_status: Counts; reviews_last_7d: Counts };
  distribution?: { by_status: Counts; dispatched_not_reconciled: number; handoffs_last_7d: number };
  stock?: { warehouses: number; tracked_item_lines: number; out_of_stock_lines: number; low_stock_lines: number;
    pending_adjustments: number; low_threshold_units: number };
  needs?: { by_status: Counts; outstanding: number };
  generated_at: string;
};
type AdminOverview = {
  users: { total: number; by_status: Counts; pending_email_verification: number; must_change_password: number;
    active_last_24h: number };
  active_users_by_role: Counts; active_organizations_by_kind: Counts;
  recent_audit: { action: string; entity_type: string; created_at: string }[];
  generated_at: string;
};
type Suggestions = { open_drives: { id: string; title: string; region_code: string | null }[];
  suggestions: { code: string; severity: string; region_code: string | null; item_ids: string[]; message: string }[];
  weather_available: boolean; generated_at: string };

function useSnapshot<T>(service: 'identity' | 'response' | 'logistics', path: string, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(enabled);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setLoading(true);
    setError('');
    void api<T>(service, path).then((result) => { if (live) setData(result); })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Chưa tải được số liệu.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [service, path, enabled, revision]);
  return { data, error, loading, refresh: () => setRevision((value) => value + 1) };
}

function SnapshotState({ loading, error, onRetry }: { loading: boolean; error: string; onRetry: () => void }) {
  if (loading) return <p role="status">Đang tải số liệu…</p>;
  if (error) return <div className="notice error" role="alert">{error} <button type="button" className="button secondary" onClick={onRetry}>Thử lại</button></div>;
  return null;
}

function Metric({ title, value, warning }: { title: string; value: number | string; warning?: boolean }) {
  return <div className={`metric-tile${warning ? ' metric-tile-warning' : ''}`}><span>{title}</span><strong>{value}</strong></div>;
}

const chartColors = ['#2563eb', '#0d9488', '#f59e0b', '#8b5cf6', '#e11d48', '#0891b2', '#65a30d', '#ea580c', '#4f46e5', '#64748b'];

function Breakdown({ title, counts, requestStatuses = false, organizationKinds = false }: { title: string; counts: Counts; requestStatuses?: boolean; organizationKinds?: boolean }) {
  const rows = Object.entries(counts).filter(([, count]) => count > 0);
  const total = rows.reduce((sum, [, count]) => sum + count, 0);
  let cursor = 0;
  const stops = rows.map(([, count], index) => {
    const start = cursor;
    cursor += count / total * 100;
    return `${chartColors[index % chartColors.length]} ${start}% ${cursor}%`;
  });
  return <section className="dashboard-breakdown"><h3>{title}</h3>
    {total ? <div className="dashboard-chart-layout">
      <div className="dashboard-donut" role="img" aria-label={`${title}: tổng ${total}`} style={{ background: `conic-gradient(${stops.join(', ')})` }}>
        <span><strong>{total}</strong><small>Tổng cộng</small></span>
      </div>
      <div className="dashboard-chart-legend">{rows.map(([code, count], index) =>
        <div className="dashboard-chart-row" key={code}><i aria-hidden="true" style={{ backgroundColor: chartColors[index % chartColors.length] }} />
          <span>{organizationKinds && code === 'VOLUNTEER' ? 'Tình nguyện' : requestStatuses ? requestStatusLabel(code) : label(code)}</span>
          <strong>{count}</strong></div>)}</div>
    </div> : <p className="muted">Chưa có số liệu.</p>}
  </section>;
}

function ResponseDashboard({ onOpenRequest }: { onOpenRequest?: (id: string) => void }) {
  const snapshot = useSnapshot<ResponseOverview>('response', '/dashboard/overview');
  const { data } = snapshot;
  return <section className="card dashboard-section"><div className="section-header"><h2>Tình hình ứng cứu</h2><button type="button" className="button secondary" onClick={snapshot.refresh}>Cập nhật</button></div>
    <SnapshotState {...snapshot} onRetry={snapshot.refresh} />
    {data && !snapshot.error && <>
      <p className="muted">Cập nhật lúc {timeLabel(data.generated_at)}. Quá hạn xác minh sau {data.thresholds.verification_overdue_minutes} phút; đề nghị nhiệm vụ sau {data.thresholds.offer_overdue_minutes} phút.</p>
      <div className="report-metrics dashboard-highlight-metrics">
        <Metric title="SOS đang mở" value={data.requests.open_total} />
        <Metric title="Quá hạn xác minh" value={data.requests.verification_overdue} warning={data.requests.verification_overdue > 0} />
        <Metric title="Khai báo nguy hiểm đang chờ" value={data.requests.declared_danger_waiting} warning={data.requests.declared_danger_waiting > 0} />
        <Metric title="Chờ giao đội" value={data.requests.awaiting_team_assignment} />
        <Metric title="Nhiệm vụ đang chạy" value={Object.values(data.missions.active_by_status).reduce((sum, count) => sum + count, 0)} />
        <Metric title="Đề nghị nhiệm vụ quá hạn" value={data.missions.overdue_offers} warning={data.missions.overdue_offers > 0} />
      </div>
      <details className="dashboard-more-metrics"><summary>Thêm số liệu về đội và SOS</summary><div className="report-metrics">
        <Metric title="Đội sẵn sàng" value={`${data.teams.available}/${data.teams.total}`} />
        <Metric title="Đội đang có nhiệm vụ" value={data.teams.on_mission} />
        <Metric title="Đội chờ xác nhận sẵn sàng" value={data.teams.awaiting_readiness} />
        <Metric title="Đội thiếu vị trí mới" value={data.teams.position_missing_or_stale} warning={data.teams.position_missing_or_stale > 0} />
        <Metric title="SOS nhận trong 24 giờ" value={data.requests.received_last_24h} />
        <Metric title="SOS đã giải quyết" value={data.requests.resolved_total} />
      </div></details>
      <div className="dashboard-breakdowns">
        <Breakdown title="SOS theo trạng thái" counts={data.requests.open_by_status} requestStatuses />
        <Breakdown title="Mức ưu tiên" counts={data.requests.open_by_priority} />
        <Breakdown title="Loại sự cố" counts={data.requests.open_by_category} />
        <Breakdown title="Khu vực" counts={data.requests.open_by_region} />
        <Breakdown title="Nhiệm vụ đang hoạt động" counts={data.missions.active_by_status} />
      </div>
      <h3>SOS mới đang mở</h3>
      {data.recent_open_requests.length ? <div className="record-list">{data.recent_open_requests.map((item) =>
        <div className="record" key={item.id}><div><strong>{requestStatusLabel(item.status)} · {label(item.category)}</strong>
          <p>{label(item.priority)} · {label(item.region_code)} · {timeLabel(item.received_at)}</p></div>
          {onOpenRequest && <button type="button" className="button secondary" onClick={() => onOpenRequest(item.id)}>Xem SOS</button>}
        </div>)}</div> : <p>Chưa có SOS đang mở.</p>}
    </>}
  </section>;
}

function AdminDashboard() {
  const snapshot = useSnapshot<AdminOverview>('identity', '/dashboard/admin');
  const { data } = snapshot;
  return <section className="card dashboard-section"><div className="section-header"><h2>Tài khoản và quyền truy cập</h2><button type="button" className="button secondary" onClick={snapshot.refresh}>Cập nhật</button></div>
    <SnapshotState {...snapshot} onRetry={snapshot.refresh} />
    {data && !snapshot.error && <>
      <p className="muted">Cập nhật lúc {timeLabel(data.generated_at)}</p>
      <div className="report-metrics"><Metric title="Tổng tài khoản" value={data.users.total} /><Metric title="Chờ xác minh email" value={data.users.pending_email_verification} />
        <Metric title="Cần đổi mật khẩu" value={data.users.must_change_password} /><Metric title="Hoạt động trong 24 giờ" value={data.users.active_last_24h} /></div>
      <div className="dashboard-breakdowns"><Breakdown title="Trạng thái tài khoản" counts={data.users.by_status} />
        <Breakdown title="Người dùng theo vai trò" counts={data.active_users_by_role} />
        <Breakdown title="Tổ chức theo loại" counts={data.active_organizations_by_kind} organizationKinds /></div>
      <h3>Thao tác gần đây</h3>{data.recent_audit.length ? <div className="record-list">{data.recent_audit.map((item, index) =>
        <div className="record" key={`${item.created_at}:${index}`}><strong>{label(item.action)}</strong><span>{label(item.entity_type)} · {timeLabel(item.created_at)}</span></div>)}</div>
        : <p>Chưa có thao tác gần đây.</p>}
    </>}
  </section>;
}

function OperationsSnapshot({ showReports }: { showReports: boolean }) {
  const snapshot = useSnapshot<OperationsOverview>('logistics', '/dashboard/operations');
  const { data } = snapshot;
  return <><section className="card dashboard-section"><div className="section-header"><h2>Vận hành cứu trợ</h2><button type="button" className="button secondary" onClick={snapshot.refresh}>Cập nhật</button></div>
    <SnapshotState {...snapshot} onRetry={snapshot.refresh} />
    {data && !snapshot.error && <><p className="muted">Cập nhật lúc {timeLabel(data.generated_at)}</p>
      {data.intake && <><h3>Tiếp nhận quyên góp</h3><div className="report-metrics"><Metric title="Chờ kiểm đếm hoặc duyệt" value={data.intake.awaiting_count_or_review} />
        <Metric title="Chờ duyệt" value={data.intake.pending_review} /><Metric title="Tranh chấp đang mở" value={data.intake.open_disputes} /></div>
        <Breakdown title="Bản giao nhận" counts={data.intake.deliveries_by_status} /><Breakdown title="Đợt quyên góp" counts={data.intake.drives_by_status} />
        <Breakdown title="Duyệt trong 7 ngày" counts={data.intake.reviews_last_7d} /></>}
      {data.distribution && <><h3>Phân phối</h3><div className="report-metrics"><Metric title="Đã xuất kho, chờ đối soát" value={data.distribution.dispatched_not_reconciled} />
        <Metric title="Lượt bàn giao trong 7 ngày" value={data.distribution.handoffs_last_7d} /></div><Breakdown title="Trạng thái phân phối" counts={data.distribution.by_status} /></>}
      {data.stock && <><h3>Kho và vật phẩm</h3><div className="report-metrics"><Metric title="Kho" value={data.stock.warehouses} />
        <Metric title="Dòng vật phẩm" value={data.stock.tracked_item_lines} /><Metric title="Hết hàng" value={data.stock.out_of_stock_lines} warning={data.stock.out_of_stock_lines > 0} />
        <Metric title="Tồn thấp" value={data.stock.low_stock_lines} warning={data.stock.low_stock_lines > 0} /><Metric title="Điều chỉnh chờ duyệt" value={data.stock.pending_adjustments} /></div>
        <p className="muted">Ngưỡng tồn thấp: {data.stock.low_threshold_units} đơn vị.</p></>}
      {data.needs && <><h3>Nhu cầu vật tư</h3><div className="report-metrics"><Metric title="Nhu cầu còn thiếu" value={data.needs.outstanding} /></div>
        <Breakdown title="Trạng thái nhu cầu" counts={data.needs.by_status} /></>}
    </>}
  </section>{showReports && <><DriveSuggestions /><details className="card dashboard-more-metrics dashboard-history">
    <summary>Báo cáo chi tiết theo khu vực và tồn kho</summary><OperationsDashboard />
  </details></>}</>;
}

function DriveSuggestions() {
  const snapshot = useSnapshot<Suggestions>('logistics', '/reports/drive-suggestions');
  const { data } = snapshot;
  return <section className="card dashboard-section"><div className="section-header"><h2>Gợi ý đợt quyên góp</h2><button type="button" className="button secondary" onClick={snapshot.refresh}>Cập nhật</button></div>
    <p>Các gợi ý dựa trên tồn kho, nhu cầu và thời tiết; người phụ trách quyết định có mở đợt mới hay không.</p>
    <SnapshotState {...snapshot} onRetry={snapshot.refresh} />
    {data && !snapshot.error && <>{!data.weather_available && <p className="notice warning">Chưa có dữ liệu thời tiết; gợi ý về kho vẫn có hiệu lực.</p>}
      {data.suggestions.length ? <div className="record-list">{data.suggestions.map((item, index) =>
        <article className="record" key={`${item.code}:${item.region_code}:${index}`}><div><strong>{label(item.severity)} · {label(item.code)}</strong>
          <p>{item.message}</p></div></article>)}</div> : <p>Chưa có gợi ý mới.</p>}
      <p className="muted">Đợt đang mở: {data.open_drives.length}.</p></>}
  </section>;
}

export function RoleDashboard({ role, showReports = false, onOpenRequest }: { role: 'coordinator' | 'operations' | 'admin';
  showReports?: boolean; onOpenRequest?: (id: string) => void }) {
  return <div className="dashboard-stack">
    {role === 'admin' && <AdminDashboard />}
    {(role === 'admin' || role === 'coordinator') && <ResponseDashboard onOpenRequest={onOpenRequest} />}
    {role === 'operations' && <OperationsSnapshot showReports={showReports} />}
  </div>;
}
