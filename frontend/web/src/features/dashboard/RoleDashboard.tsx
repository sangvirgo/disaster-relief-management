import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../api/client';
import { label, requestStatusLabel, timeLabel } from '../../i18n/labels';
import { useUrlView } from '../../app/useUrlView';
import { Tabs } from '../../components/ui/Tabs';
import './role-dashboard.css';

type Counts = Record<string, number>;
type ResponseOverview = {
  requests: { open_total: number; open_by_status: Counts; open_by_priority: Counts; open_by_category: Counts;
    received_last_24h: number; resolved_total: number; verification_overdue: number;
    declared_danger_waiting: number; awaiting_team_assignment: number };
  missions: { active_by_status: Counts; overdue_offers: number };
  teams: { total: number; available: number; unavailable: number; awaiting_readiness: number;
    on_mission: number; position_missing_or_stale: number };
  thresholds: { verification_overdue_minutes: number; offer_overdue_minutes: number; team_position_fresh_minutes: number };
  generated_at: string;
};
type OperationsOverview = {
  intake?: { deliveries_by_status: Counts; awaiting_count_or_review: number; pending_review: number;
    open_disputes: number; drives_by_status: Counts; reviews_last_7d: Counts };
  supply?: { waiting: number; expiring_soon: number; handed_over_last_7d: number; expired_last_7d: number };
  stock?: { warehouses: number; tracked_item_lines: number; out_of_stock_lines: number; low_stock_lines: number;
    pending_adjustments: number; low_threshold_units: number };
  needs?: { by_status: Counts; outstanding: number };
  generated_at: string;
};
type AdminOverview = {
  users: { total: number; by_status: Counts; pending_email_verification: number; must_change_password: number;
    active_last_24h: number };
  active_users_by_role: Counts;
  generated_at: string;
};
type Suggestions = { open_drives: { id: string; title: string }[];
  suggestions: { code: string; severity: string; item_ids: string[]; message: string }[];
  weather_available: boolean; generated_at: string };

const dashboardViews = ['overview', 'report'] as const;
const sum = (counts: Counts | undefined) => Object.values(counts || {}).reduce((total, value) => total + value, 0);
const roleLabels: Record<string, string> = {
  ADMIN: 'Quản trị viên', COORDINATOR: 'Điều phối viên', OPERATIONS_MANAGER: 'Quản lý vận hành',
  REVIEWER: 'Người duyệt', VOLUNTEER: 'Tình nguyện viên', CITIZEN: 'Người dân',
};

function useSnapshot<T>(service: 'identity' | 'response' | 'logistics', path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    void api<T>(service, path).then((result) => { if (live) setData(result); })
      .catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : 'Chưa tải được số liệu.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [service, path, revision]);
  return { data, error, loading, refresh: () => setRevision((value) => value + 1) };
}

function Panel({ title, updated, onRefresh, loading, error, children, className = '' }: {
  title: string; updated?: string; onRefresh?: () => void; loading?: boolean; error?: string; children?: ReactNode; className?: string;
}) {
  return <section className={`card dash-panel ${className}`}>
    <header className="dash-panel__head">
      <div><h2>{title}</h2>{updated && <p className="muted">Cập nhật lúc {timeLabel(updated)}</p>}</div>
      {onRefresh && <button type="button" className="button secondary refresh-action" disabled={loading} onClick={onRefresh}>Làm mới</button>}
    </header>
    {loading && !error && <p role="status" className="muted">Đang tải số liệu…</p>}
    {error && <div className="notice error" role="alert">{error} {onRefresh && <button type="button" className="button secondary" onClick={onRefresh}>Thử lại</button>}</div>}
    {children}
  </section>;
}

type Attention = { count: number; title: string; hint: string; href?: string; tone: 'danger' | 'warning' | 'info' };
/** Things that need a person now, most urgent first; each opens the page where it is handled. */
function AttentionList({ items, empty }: { items: Attention[]; empty: string }) {
  const shown = items.filter((item) => item.count > 0);
  if (!shown.length) return <p className="dash-all-clear" role="status"><span aria-hidden="true">✓</span>{empty}</p>;
  return <ul className="dash-attention" aria-label="Việc cần xử lý">
    {shown.map((item) => {
      const body = <>
        <strong className="dash-attention__count">{item.count}</strong>
        <span className="dash-attention__text"><b>{item.title}</b><small>{item.hint}</small></span>
        {item.href && <span className="dash-attention__go" aria-hidden="true">›</span>}
      </>;
      return <li key={item.title} className={`dash-attention__item dash-attention__item--${item.tone}`}>
        {item.href ? <a href={item.href}>{body}</a> : <div>{body}</div>}
      </li>;
    })}
  </ul>;
}

function Kpis({ items }: { items: { title: string; value: ReactNode; hint?: string }[] }) {
  return <dl className="dash-kpis">{items.map((item) => <div key={item.title} className="dash-kpi">
    <dt>{item.title}</dt><dd>{item.value}</dd>{item.hint && <small>{item.hint}</small>}
  </div>)}</dl>;
}

/** Single-hue horizontal bars: magnitude per category, sorted unless an order is given. */
function Bars({ title, counts, labelFor = label, order, href }: {
  title: string; counts: Counts | undefined; labelFor?: (code: string) => string; order?: string[]; href?: string;
}) {
  const rows = (order ? order.map((code) => [code, counts?.[code] ?? 0] as [string, number]) : Object.entries(counts || {}).sort((a, b) => b[1] - a[1]))
    .filter(([, count]) => order || count > 0);
  const max = Math.max(1, ...rows.map(([, count]) => count));
  const total = rows.reduce((value, [, count]) => value + count, 0);
  return <section className="dash-bars">
    <header><h3>{title}</h3><span className="muted">Tổng {total}</span></header>
    {total === 0 ? <p className="muted">Chưa có số liệu.</p> : <ul>
      {rows.map(([code, count]) => <li key={code} title={`${labelFor(code)}: ${count}`}>
        <span className="dash-bars__label">{labelFor(code)}</span>
        <span className="dash-bars__track"><span className="dash-bars__fill" style={{ width: `${count ? Math.max(2, count / max * 100) : 0}%` }} /></span>
        <strong className="dash-bars__value">{count}</strong>
      </li>)}
    </ul>}
    {href && <a className="dash-link" href={href}>Xem chi tiết ›</a>}
  </section>;
}

function DashboardTabs({ children }: { children: (view: (typeof dashboardViews)[number]) => ReactNode }) {
  const [view, setView] = useUrlView('view', dashboardViews, 'overview');
  return <div className="dash">
    <Tabs items={[{ id: 'overview', label: 'Việc cần làm' }, { id: 'report', label: 'Báo cáo' }]} value={view}
      onChange={(next) => setView(next as (typeof dashboardViews)[number])} ariaLabel="Nội dung thống kê" idBase="dashboard" />
    <div className="dash-stack" role="tabpanel" aria-labelledby={`dashboard-tab-${view}`}>{children(view)}</div>
  </div>;
}

const sosQueue = '?workspace=coordinator&page=campaigns&campaign_tab=sos';

function ResponseOverviewPanels({ view, compact = false }: { view: 'overview' | 'report'; compact?: boolean }) {
  const snapshot = useSnapshot<ResponseOverview>('response', '/dashboard/overview');
  const { data } = snapshot;
  const missions = sum(data?.missions.active_by_status);
  if (view === 'report') return <Panel title="Báo cáo ứng cứu" updated={data?.generated_at} onRefresh={snapshot.refresh} loading={snapshot.loading} error={snapshot.error}>
    {data && <div className="dash-grid">
      <Bars title="SOS đang mở theo trạng thái" counts={data.requests.open_by_status} labelFor={requestStatusLabel} />
      <Bars title="Mức ưu tiên đã quyết định" counts={data.requests.open_by_priority} order={['P1', 'P2', 'P3', 'P4']} />
      <Bars title="Loại sự cố" counts={data.requests.open_by_category} />
      <Bars title="Nhiệm vụ đang hoạt động" counts={data.missions.active_by_status} />
      <Bars title="Đội cứu hộ" counts={{ AVAILABLE: data.teams.available, ON_MISSION: data.teams.on_mission,
        AWAITING_READINESS: data.teams.awaiting_readiness, UNAVAILABLE: data.teams.unavailable }}
        order={['AVAILABLE', 'ON_MISSION', 'AWAITING_READINESS', 'UNAVAILABLE']}
        labelFor={(code) => ({ AVAILABLE: 'Sẵn sàng', ON_MISSION: 'Đang làm nhiệm vụ', AWAITING_READINESS: 'Chờ xác nhận sẵn sàng', UNAVAILABLE: 'Không sẵn sàng' }[code] || code)} />
    </div>}
    {data && <a className="dash-link" href="?workspace=coordinator&page=reports">Xem bản đồ nhiệt SOS ›</a>}
  </Panel>;
  return <Panel title={compact ? 'Tình hình ứng cứu' : 'Việc cần xử lý'} updated={data?.generated_at} onRefresh={snapshot.refresh} loading={snapshot.loading} error={snapshot.error}>
    {data && <>
      {!compact && <AttentionList empty="Không có SOS nguy hiểm, quá hạn hay chờ giao đội." items={[
        { count: data.requests.declared_danger_waiting, tone: 'danger', title: 'SOS khai báo nguy hiểm tính mạng đang chờ', hint: 'Kiểm tra và xử lý trước tiên.', href: sosQueue },
        { count: data.requests.verification_overdue, tone: 'warning', title: 'SOS quá hạn xác minh', hint: `Chờ quá ${data.thresholds.verification_overdue_minutes} phút chưa được xác minh.`, href: sosQueue },
        { count: data.requests.awaiting_team_assignment, tone: 'warning', title: 'SOS đã xác minh, chờ giao đội', hint: 'Chọn đội phù hợp ở tab Điều phối của SOS.', href: sosQueue },
        { count: data.missions.overdue_offers, tone: 'warning', title: 'Đề nghị nhiệm vụ chưa được đội nhận', hint: `Quá ${data.thresholds.offer_overdue_minutes} phút; cân nhắc giao đội khác.`, href: sosQueue },
        { count: data.teams.position_missing_or_stale, tone: 'info', title: 'Đội thiếu vị trí mới', hint: `Không cập nhật vị trí trong ${data.thresholds.team_position_fresh_minutes} phút.`, href: '?workspace=coordinator&page=teams' },
      ]} />}
      <Kpis items={[
        { title: 'SOS đang mở', value: data.requests.open_total },
        { title: 'Nhận trong 24 giờ', value: data.requests.received_last_24h },
        { title: 'Nhiệm vụ đang chạy', value: missions },
        { title: 'Đội sẵn sàng', value: `${data.teams.available}/${data.teams.total}` },
        ...(compact ? [] : [{ title: 'SOS đã giải quyết', value: data.requests.resolved_total, hint: 'Tổng từ trước đến nay' }]),
      ]} />
    </>}
  </Panel>;
}

function AdminPanels({ view }: { view: 'overview' | 'report' }) {
  const snapshot = useSnapshot<AdminOverview>('identity', '/dashboard/admin');
  const { data } = snapshot;
  if (view === 'report') return <>
    <Panel title="Tài khoản" updated={data?.generated_at} onRefresh={snapshot.refresh} loading={snapshot.loading} error={snapshot.error}>
      {data && <div className="dash-grid">
        <Bars title="Tài khoản theo trạng thái" counts={data.users.by_status} />
        <Bars title="Người dùng đang hoạt động theo vai trò" counts={data.active_users_by_role} labelFor={(code) => roleLabels[code] || label(code)} />
      </div>}
    </Panel>
    <ResponseOverviewPanels view="report" />
  </>;
  return <>
    <Panel title="Tài khoản và quyền truy cập" updated={data?.generated_at} onRefresh={snapshot.refresh} loading={snapshot.loading} error={snapshot.error}>
      {data && <>
        <AttentionList empty="Không có tài khoản cần xử lý." items={[
          { count: data.users.pending_email_verification, tone: 'warning', title: 'Tài khoản chờ xác minh email', hint: 'Người dùng chưa hoàn tất đăng ký.', href: '?workspace=admin&page=users' },
          { count: data.users.must_change_password, tone: 'info', title: 'Tài khoản phải đổi mật khẩu', hint: 'Sẽ được yêu cầu đổi ở lần đăng nhập tới.', href: '?workspace=admin&page=users' },
        ]} />
        <Kpis items={[
          { title: 'Tổng tài khoản', value: data.users.total },
          { title: 'Hoạt động trong 24 giờ', value: data.users.active_last_24h },
          { title: 'Vai trò đang dùng', value: Object.keys(data.active_users_by_role).length },
        ]} />
        <a className="dash-link" href="?workspace=admin&page=audit">Xem lịch sử thao tác ›</a>
      </>}
    </Panel>
    <ResponseOverviewPanels view="overview" compact />
  </>;
}

const intakeHref = (step: string, extra = '') => `?workspace=operations&page=intake&step=${step}${extra}`;

const handoverHref = (status = '') => `?workspace=operations&page=handover${status ? `&status=${status}` : ''}`;

/** The warehouse's one job for rescue teams: goods reserved and waiting to be handed over. */
function SupplyStrip({ supply }: { supply: NonNullable<OperationsOverview['supply']> }) {
  return <section className="dash-pipeline" aria-label="Giao hàng cho đội cứu hộ">
    <header><h3>Giao hàng cho đội cứu hộ</h3><a className="muted" href={handoverHref()}>Mở danh sách ›</a></header>
    <ol>
      <li><a href={handoverHref()} className={supply.waiting ? 'has-work' : ''}>
        <span className="dash-pipeline__index">1</span><strong>{supply.waiting}</strong><span>Đội chờ nhận hàng</span>
      </a></li>
      <li><a href={handoverHref()} className={supply.expiring_soon ? 'has-work' : ''}>
        <span className="dash-pipeline__index">!</span><strong>{supply.expiring_soon}</strong><span>Sắp hết hạn nhận (dưới 1 giờ)</span>
      </a></li>
      <li><a href={handoverHref()}>
        <span className="dash-pipeline__index">2</span><strong>{supply.handed_over_last_7d}</strong><span>Đã giao 7 ngày qua</span>
      </a></li>
    </ol>
  </section>;
}

function OperationsPanels({ view, manages, reviews }: { view: 'overview' | 'report'; manages: boolean; reviews: boolean }) {
  const snapshot = useSnapshot<OperationsOverview>('logistics', '/dashboard/operations');
  const { data } = snapshot;
  if (view === 'report') return <>
    <Panel title="Báo cáo vận hành" updated={data?.generated_at} onRefresh={snapshot.refresh} loading={snapshot.loading} error={snapshot.error}>
      {data && <div className="dash-grid">
        {data.intake && <Bars title="Hàng quyên góp theo trạng thái" counts={data.intake.deliveries_by_status} href={intakeHref(manages ? 'intake' : 'review')} />}
        {data.intake && <Bars title="Đợt quyên góp" counts={data.intake.drives_by_status} href={manages ? '?workspace=operations&page=assets' : undefined} />}
        {data.needs && <Bars title="Nhu cầu vật tư của các chiến dịch" counts={data.needs.by_status} href={manages ? '?workspace=operations&page=supply' : undefined} />}
        {data.intake && <Bars title="Kết quả duyệt biên nhận 7 ngày qua" counts={data.intake.reviews_last_7d} />}
      </div>}
      {manages && data && <a className="dash-link" href="?workspace=operations&page=reports">Báo cáo tồn kho và đối soát ›</a>}
    </Panel>
    {manages && <DriveSuggestions />}
  </>;
  return <Panel title="Việc cần xử lý" updated={data?.generated_at} onRefresh={snapshot.refresh} loading={snapshot.loading} error={snapshot.error}>
    {data && <>
      <AttentionList empty="Không có việc tồn đọng trong phạm vi của bạn." items={[
        ...(data.intake ? [
          { count: data.intake.pending_review, tone: 'warning' as const, title: 'Biên nhận chờ xác nhận kiểm đếm', hint: 'Cần một người khác người đã đếm.', href: reviews ? intakeHref('review') : undefined },
          { count: Math.max(0, data.intake.awaiting_count_or_review - data.intake.pending_review), tone: 'info' as const, title: 'Hàng quyên góp chờ kiểm đếm', hint: 'Đếm hàng thực tế khi hàng đến kho.', href: intakeHref(manages ? 'intake' : 'review') },
          { count: data.intake.open_disputes, tone: 'warning' as const, title: 'Khiếu nại đang mở', hint: 'Người đóng góp phản hồi về kết quả kiểm đếm.', href: reviews ? intakeHref('review', '&view=disputes') : undefined },
        ] : []),
        ...(data.supply ? [
          { count: data.supply.expiring_soon, tone: 'danger' as const, title: 'Đội sắp hết hạn nhận hàng', hint: 'Hàng đã giữ sẽ tự trả về kệ nếu đội chưa đến nhận.', href: manages ? handoverHref() : undefined },
          { count: data.supply.waiting, tone: 'warning' as const, title: 'Đội cứu hộ chờ nhận hàng', hint: 'Soạn sẵn hàng; khi đội đến, nhập mã nhận hàng để giao.', href: manages ? handoverHref() : undefined },
        ] : []),
        ...(data.stock ? [
          { count: data.stock.out_of_stock_lines, tone: 'danger' as const, title: 'Vật phẩm đã hết hàng tại kho', hint: 'Cân nhắc mở đợt quyên góp hoặc điều chuyển.', href: manages ? '?workspace=operations&page=reports&view=stock-summary' : undefined },
          { count: data.stock.pending_adjustments, tone: 'info' as const, title: 'Điều chỉnh tồn kho chờ duyệt', hint: 'Cần người duyệt độc lập.' },
        ] : []),
      ]} />
      {data.supply && manages && <SupplyStrip supply={data.supply} />}
      <Kpis items={[
        ...(data.stock ? [
          { title: 'Kho đang hoạt động', value: data.stock.warehouses },
          { title: 'Dòng vật phẩm theo dõi', value: data.stock.tracked_item_lines },
          { title: 'Sắp hết hàng', value: data.stock.low_stock_lines, hint: `Còn ≤ ${data.stock.low_threshold_units} đơn vị` },
        ] : []),
        ...(data.needs ? [{ title: 'Nhu cầu còn thiếu', value: data.needs.outstanding }] : []),
        ...(data.supply ? [{ title: 'Yêu cầu hết hạn 7 ngày', value: data.supply.expired_last_7d, hint: 'Đội không đến nhận kịp' }] : []),
      ]} />
    </>}
  </Panel>;
}

function DriveSuggestions() {
  const snapshot = useSnapshot<Suggestions>('logistics', '/reports/drive-suggestions');
  const { data } = snapshot;
  return <Panel title="Gợi ý mở đợt quyên góp" updated={data?.generated_at} onRefresh={snapshot.refresh} loading={snapshot.loading} error={snapshot.error}>
    <p className="muted">Gợi ý dựa trên tồn kho, nhu cầu và thời tiết; người phụ trách quyết định có mở đợt mới hay không.</p>
    {data && <>
      {!data.weather_available && <p className="notice warning">Chưa có dữ liệu thời tiết; gợi ý về kho vẫn có hiệu lực.</p>}
      {data.suggestions.length ? <ul className="dash-suggestions">{data.suggestions.map((item, index) =>
        <li key={`${item.code}:${index}`} data-severity={item.severity}><strong>{label(item.code)}</strong><span>{item.message}</span></li>)}</ul>
        : <p>Chưa có gợi ý mới.</p>}
      <p className="muted">Đợt quyên góp đang mở: {data.open_drives.length}.</p>
    </>}
  </Panel>;
}

export function RoleDashboard({ role, manages = false, reviews = false }: { role: 'coordinator' | 'operations' | 'admin'; manages?: boolean; reviews?: boolean }) {
  return <DashboardTabs>{(view) => role === 'admin' ? <AdminPanels view={view} />
    : role === 'coordinator' ? <ResponseOverviewPanels view={view} />
      : <OperationsPanels view={view} manages={manages} reviews={reviews} />}</DashboardTabs>;
}
