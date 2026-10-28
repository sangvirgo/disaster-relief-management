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
      id: 'home',
      title: 'Tổng quan',
      icon: 'home',
      note: 'Gửi yêu cầu hỗ trợ, theo dõi tiến độ và tìm thông tin cứu trợ.',
    },
    {
      id: 'sos',
      title: 'Gửi yêu cầu SOS',
      icon: 'sos',
      note: 'Cho biết tình huống và vị trí của người cần hỗ trợ để gửi yêu cầu.',
    },
    {
      id: 'receipt',
      title: 'Xác nhận tiếp nhận',
      icon: 'receipt',
      note: 'Mã theo dõi chỉ hiện sau khi máy chủ xác nhận yêu cầu.',
    },
    { id: 'track', title: 'Theo dõi SOS', icon: 'track' },
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
    {
      id: 'declare',
      title: 'Khai báo vật phẩm',
      icon: 'declare',
      note: 'Chọn một đợt quyên góp đang mở để xem vật phẩm được tiếp nhận.',
    },
    {
      id: 'donation',
      title: 'Theo dõi đóng góp',
      icon: 'donation',
      note: 'Bản khai không làm tăng tồn kho. Số lượng được tiếp nhận chỉ xác định sau kiểm đếm và duyệt độc lập.',
    },
    {
      id: 'account',
      title: 'Tài khoản',
      icon: 'account',
      service: 'response',
      path: '/requests/mine',
    },
  ],
  volunteer: [
    {
      id: 'overview',
      title: 'Tổng quan',
      icon: 'home',
      service: 'response',
      path: '/missions/mine',
    },
    {
      id: 'missions',
      title: 'Nhiệm vụ',
      icon: 'mission',
      service: 'response',
      path: '/missions/mine',
    },
    {
      id: 'progress',
      title: 'Tiến độ',
      icon: 'progress',
      service: 'response',
      path: '/missions/mine',
    },
    { id: 'team', title: 'Đội cứu hộ', icon: 'team', service: 'response', path: '/teams' },
    { id: 'notices', title: 'Thông báo', icon: 'notice', service: 'response', path: '/notices' },
  ],
  coordinator: [
    { id: 'queue', title: 'Hàng đợi SOS', icon: 'queue', service: 'response', path: '/requests' },
    {
      id: 'verify',
      title: 'Xác minh',
      icon: 'verify',
      service: 'response',
      path: '/requests?status=SUBMITTED',
    },
    {
      id: 'triage',
      title: 'Ưu tiên',
      icon: 'priority',
      service: 'response',
      path: '/requests?status=VERIFIED',
    },
    {
      id: 'assign',
      title: 'Giao đội',
      icon: 'assign',
      service: 'response',
      path: '/requests?status=VERIFIED',
    },
    {
      id: 'map',
      title: 'Bản đồ',
      icon: 'map',
      note: 'Bản đồ chỉ hiển thị dữ liệu đã tổng hợp theo quyền truy cập; không hiển thị vị trí nạn nhân công khai.',
    },
    { id: 'notices', title: 'Thông báo', icon: 'notice', service: 'response', path: '/notices' },
    { id: 'needs', title: 'Nhu cầu vật tư', icon: 'needs', service: 'logistics', path: '/needs' },
    {
      id: 'campaigns',
      title: 'Chiến dịch',
      icon: 'campaign',
      service: 'response',
      path: '/campaigns',
    },
    {
      id: 'reports',
      title: 'Tổng quan',
      icon: 'report',
      service: 'response',
      path: '/reports/summary',
      note: 'Số liệu bảy ngày gần đây từ dịch vụ Response.',
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
    {
      id: 'review',
      title: 'Duyệt biên nhận',
      icon: 'review',
      service: 'logistics',
      path: '/donation-disputes',
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
      id: 'handoff',
      title: 'Bàn giao',
      icon: 'handoff',
      service: 'logistics',
      path: '/distributions',
    },
    {
      id: 'reports',
      title: 'Đối soát',
      icon: 'report',
      service: 'logistics',
      path: '/reconciliation',
    },
  ],
  admin: [
    { id: 'overview', title: 'Tổng quan', icon: 'home', service: 'identity', path: '/users' },
    { id: 'users', title: 'Người dùng', icon: 'users', service: 'identity', path: '/users' },
    {
      id: 'organizations',
      title: 'Tổ chức',
      icon: 'organization',
      service: 'identity',
      path: '/organizations',
    },
    { id: 'grants', title: 'Phân quyền', icon: 'grants', service: 'identity', path: '/users' },
    { id: 'regions', title: 'Khu vực', icon: 'regions', service: 'identity', path: '/regions' },
    {
      id: 'audit',
      title: 'Nhật ký kiểm toán',
      icon: 'audit',
      note: 'Chọn loại đối tượng trước khi tra cứu nhật ký; lý do thao tác là dữ liệu hạn chế.',
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
    if (workspace === 'citizen') return page.id !== 'account' || !!user;
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
    if (page.id === 'review') return r.has('REVIEWER');
    if (page.id === 'distribution' || page.id === 'handoff')
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
    return r.has('OPERATIONS_MANAGER') || r.has('CAMPAIGN_MANAGER');
  });
}
