import type { Me } from '../auth/session';
import { roles } from '../auth/session';
import type { Service } from '../api/client';

export type Workspace = 'citizen' | 'volunteer' | 'coordinator' | 'operations' | 'admin';
export interface Page {
  id: string;
  title: string;
  icon: string;
  service?: Service;
  path?: string;
  note?: string;
}
export const pages: Record<Workspace, Page[]> = {
  citizen: [
    {
      id: 'sos',
      title: 'Gửi yêu cầu SOS',
      icon: 'sos',
      note: 'Cho biết tình huống và vị trí của người cần hỗ trợ để gửi yêu cầu.',
    },
    { id: 'track', title: 'Theo dõi SOS', icon: 'track', note: 'Xem các SOS của bạn và tiến độ xử lý.' },
    {
      id: 'campaigns',
      title: 'Chiến dịch cứu trợ',
      icon: 'campaign',
      service: 'response',
      path: '/public/campaigns',
    },
    {
      id: 'drives',
      title: 'Đợt quyên góp',
      icon: 'drive',
      service: 'logistics',
      path: '/public/donation-drives',
    },
  ],
  volunteer: [
    {
      id: 'missions',
      title: 'Nhiệm vụ',
      icon: 'mission',
      service: 'response',
      path: '/missions/mine',
    },
    { id: 'team', title: 'Đội cứu hộ', icon: 'team', service: 'response', path: '/teams' },
    { id: 'notices', title: 'Thông báo', icon: 'notice', service: 'response', path: '/notices' },
  ],
  coordinator: [
    { id: 'dashboard', title: 'Thống kê', icon: 'report' },
    {
      id: 'reports', title: 'Tổng quan và bản đồ', icon: 'report', service: 'response',
      path: '/reports/summary', note: 'Tình hình SOS, nhiệm vụ và bản đồ nhiệt theo khu vực.',
    },
    { id: 'queue', title: 'Xử lý SOS', icon: 'queue', service: 'response', path: '/requests' },
    { id: 'teams', title: 'Đội cứu hộ', icon: 'team', service: 'response', path: '/teams' },
    { id: 'notices', title: 'Thông báo', icon: 'notice', service: 'response', path: '/notices' },
    { id: 'needs', title: 'Nhu cầu vật tư', icon: 'needs', service: 'logistics', path: '/needs' },
    {
      id: 'campaigns',
      title: 'Chiến dịch',
      icon: 'campaign',
      service: 'response',
      path: '/campaigns',
    },
  ],
  operations: [
    {
      id: 'overview',
      title: 'Tổng quan',
      icon: 'home',
      service: 'logistics',
      path: '/reports/stock-summary',
    },
    {
      id: 'campaigns',
      title: 'Chiến dịch',
      icon: 'campaign',
      service: 'response',
      path: '/campaigns',
    },
    {
      id: 'drives',
      title: 'Đợt quyên góp',
      icon: 'drive',
      service: 'logistics',
      path: '/donation-drives',
    },
    {
      id: 'intake',
      title: 'Tiếp nhận',
      icon: 'intake',
      service: 'logistics',
      path: '/donation-deliveries',
    },
    { id: 'stock', title: 'Tồn kho', icon: 'stock', service: 'logistics', path: '/stock' },
    {
      id: 'assets',
      title: 'Điểm và phương tiện',
      icon: 'assets',
      service: 'logistics',
      path: '/relief-points',
    },
    { id: 'needs', title: 'Nhu cầu', icon: 'needs', service: 'logistics', path: '/needs' },
    {
      id: 'distribution',
      title: 'Phân phối',
      icon: 'distribution',
      service: 'logistics',
      path: '/distributions',
    },
    {
      id: 'reports',
      title: 'Báo cáo',
      icon: 'report',
      service: 'logistics',
      path: '/reconciliation',
    },
  ],
  admin: [
    { id: 'dashboard', title: 'Thống kê', icon: 'report' },
    { id: 'teams', title: 'Đội cứu hộ', icon: 'team', service: 'response', path: '/teams' },
    { id: 'users', title: 'Người dùng', icon: 'users', service: 'identity', path: '/users' },
    {
      id: 'organizations',
      title: 'Tổ chức',
      icon: 'organization',
      service: 'identity',
      path: '/organizations',
    },
    { id: 'regions', title: 'Khu vực', icon: 'regions', service: 'identity', path: '/regions' },
    {
      id: 'audit',
      title: 'Lịch sử thao tác',
      icon: 'audit',
      note: 'Xem lịch sử thay đổi người dùng, quyền truy cập, tổ chức và khu vực.',
    },
  ],
};
export const workspaceLabels: Record<Workspace, string> = {
  citizen: 'Người dân',
  volunteer: 'Tình nguyện và cứu hộ',
  coordinator: 'Điều phối',
  operations: 'Vận hành cứu trợ',
  admin: 'Quản trị',
};
export function allowedWorkspaces(user: Me | null): Workspace[] {
  const r = roles(user);
  const result: Workspace[] = ['citizen'];
  if (r.has('VOLUNTEER')) result.push('volunteer');
  if (r.has('COORDINATOR')) result.push('coordinator');
  if (
    [
      'OPERATIONS_MANAGER',
      'CAMPAIGN_MANAGER',
      'INTAKE_STAFF',
      'REVIEWER',
      'DISTRIBUTION_STAFF',
    ].some((role) => r.has(role))
  )
    result.push('operations');
  if (r.has('ADMIN')) result.push('admin');
  return result;
}
export function allowedPages(workspace: Workspace, user: Me | null): Page[] {
  const r = roles(user);
  return pages[workspace].filter((page) => {
    if (workspace === 'citizen') return true;
    if (workspace === 'volunteer') return r.has('VOLUNTEER');
    if (workspace === 'coordinator') return r.has('COORDINATOR');
    if (workspace === 'admin') return r.has('ADMIN');
    if (page.id === 'drives')
      return (
        r.has('OPERATIONS_MANAGER') ||
        r.has('CAMPAIGN_MANAGER') ||
        r.has('INTAKE_STAFF') ||
        r.has('REVIEWER')
      );
    if (page.id === 'campaigns') return r.has('OPERATIONS_MANAGER') || r.has('CAMPAIGN_MANAGER');
    if (page.id === 'intake') return r.has('INTAKE_STAFF') || r.has('REVIEWER');
    if (page.id === 'distribution')
      return (
        r.has('OPERATIONS_MANAGER') ||
        r.has('DISTRIBUTION_STAFF') ||
        r.has('INTAKE_STAFF') ||
        r.has('REVIEWER')
      );
    if (page.id === 'assets' || page.id === 'needs') return r.has('OPERATIONS_MANAGER');
    if (page.id === 'stock')
      return (
        r.has('OPERATIONS_MANAGER') ||
        r.has('CAMPAIGN_MANAGER') ||
        r.has('INTAKE_STAFF') ||
        r.has('REVIEWER') ||
        r.has('DISTRIBUTION_STAFF')
      );
    if (page.id === 'overview') return ['OPERATIONS_MANAGER', 'CAMPAIGN_MANAGER', 'INTAKE_STAFF', 'REVIEWER', 'DISTRIBUTION_STAFF'].some((role) => r.has(role));
    return r.has('OPERATIONS_MANAGER') || r.has('CAMPAIGN_MANAGER');
  }).map((page) => workspace === 'operations' && page.id === 'intake' && r.has('REVIEWER')
    ? { ...page, title: 'Tiếp nhận và duyệt' }
    : page);
}
