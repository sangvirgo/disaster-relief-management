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
    { id: 'campaigns', title: 'Chiến dịch và điều phối', icon: 'campaign', service: 'response', path: '/campaigns/overview' },
    { id: 'drives', title: 'Đợt quyên góp', icon: 'drive', service: 'logistics', path: '/donation-drives' },
    { id: 'dashboard', title: 'Thống kê', icon: 'report' },
    {
      id: 'reports', title: 'Tổng quan và bản đồ', icon: 'report', service: 'response',
      path: '/reports/summary', note: 'Tình hình SOS, nhiệm vụ và bản đồ nhiệt.',
    },
    { id: 'teams', title: 'Đội cứu hộ', icon: 'team', service: 'response', path: '/teams' },
    { id: 'notices', title: 'Thông báo', icon: 'notice', service: 'response', path: '/notices' },
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
      title: 'Điểm cứu trợ',
      icon: 'assets',
      service: 'logistics',
      path: '/relief-points',
    },
    { id: 'needs', title: 'Nhu cầu vật tư', icon: 'needs', service: 'logistics', path: '/needs' },
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
    { id: 'users', title: 'Người dùng', icon: 'users', service: 'identity', path: '/users' },
    { id: 'teams', title: 'Đội cứu hộ', icon: 'team', service: 'response', path: '/teams' },
    {
      id: 'audit',
      title: 'Lịch sử thao tác',
      icon: 'audit',
      note: 'Xem lịch sử thay đổi người dùng và quyền truy cập.',
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
const operationsRoles = ['OPERATIONS_MANAGER', 'REVIEWER'] as const;
export function allowedWorkspaces(user: Me | null): Workspace[] {
  const r: ReadonlySet<string> = roles(user);
  const result: Workspace[] = ['citizen'];
  if (r.has('VOLUNTEER')) result.push('volunteer');
  if (r.has('COORDINATOR') || r.has('CAMPAIGN_COORDINATOR')) result.push('coordinator');
  if (operationsRoles.some((role) => r.has(role))) result.push('operations');
  if (r.has('ADMIN')) result.push('admin');
  return result;
}
/** Role codes of the user that grant access to a workspace (for display only). */
export function workspaceRoleCodes(workspace: Workspace, user: Me | null): string[] {
  const r: ReadonlySet<string> = roles(user);
  if (workspace === 'citizen') return ['CITIZEN'];
  if (workspace === 'volunteer') return ['VOLUNTEER'];
  if (workspace === 'coordinator') return ['COORDINATOR', 'CAMPAIGN_COORDINATOR'].filter((role) => r.has(role));
  if (workspace === 'admin') return ['ADMIN'];
  return operationsRoles.filter((role) => r.has(role));
}
export function allowedPages(workspace: Workspace, user: Me | null): Page[] {
  const r: ReadonlySet<string> = roles(user);
  return pages[workspace].filter((page) => {
    if (workspace === 'citizen') return true;
    if (workspace === 'volunteer') return r.has('VOLUNTEER');
    if (workspace === 'coordinator') return page.id === 'drives' ? r.has('COORDINATOR') : r.has('COORDINATOR') || r.has('CAMPAIGN_COORDINATOR');
    if (workspace === 'admin') return r.has('ADMIN');
    const manages = r.has('OPERATIONS_MANAGER');
    const reviews = r.has('REVIEWER');
    if (page.id === 'drives') return manages || reviews;
    if (page.id === 'campaigns') return manages;
    if (page.id === 'intake') return manages || reviews;
    if (page.id === 'assets' || page.id === 'needs') return manages;
    if (page.id === 'stock') return manages || reviews;
    if (page.id === 'overview') return manages || reviews;
    return manages;
  }).map((page) => workspace === 'operations' && page.id === 'intake'
    ? { ...page, title: r.has('REVIEWER') ? 'Tiếp nhận, duyệt và phân phối' : 'Tiếp nhận và phân phối' }
    : page);
}
