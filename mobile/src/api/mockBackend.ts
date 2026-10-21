import { AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { generateUUID, generateRandomSecret } from '../utils/secureStore';
import {
  RequestStatus,
  MissionStatus,
  RequestTrackingDetail,
  MyRequestItem,
  Mission,
  NoticeItem,
} from '../types/api';

// Biến cờ bật / tắt chế độ giả lập backend (không cần bật Docker)
export const USE_MOCK_DATA = false;

// Dữ liệu người dùng mẫu
interface MockUser {
  id: string;
  username: string;
  display_name: string;
  password: string;
  roles: Array<'CITIZEN' | 'VOLUNTEER' | 'COORDINATOR' | 'ADMIN'>;
}

const mockUsers: MockUser[] = [
  {
    id: 'user-leader-01',
    username: 'leader1',
    display_name: 'Đội Trưởng Nguyễn Văn Hùng',
    password: 'Password123!',
    roles: ['VOLUNTEER'],
  },
  {
    id: 'user-citizen-01',
    username: 'citizen1',
    display_name: 'Trần Thị Mai',
    password: 'Password123!',
    roles: ['CITIZEN'],
  },
];

// Danh sách yêu cầu cứu trợ mẫu
const mockRequests: Array<{
  id: string;
  tracking_code: string;
  tracking_secret: string;
  reporter_user_id: string | null;
  status: RequestStatus;
  version: number;
  received_at: string;
  incident_category_code: string;
  people_affected: number;
  description: string;
  location: any;
  timeline: Array<{
    event_type: string;
    occurred_at: string;
    public_text_code: string;
  }>;
}> = [
  {
    id: 'req-mock-01',
    tracking_code: 'SOS8921XYZ',
    tracking_secret: 'mock-secret-43chars-base64url-00000000000000',
    reporter_user_id: 'user-citizen-01',
    status: 'IN_PROGRESS',
    version: 3,
    received_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    incident_category_code: 'FLOOD',
    people_affected: 4,
    description: 'Nước dâng cao 1.5m gần chạm nóc, trong nhà có 1 người già và 1 trẻ nhỏ.',
    location: {
      type: 'Point',
      coordinates: [106.7009, 10.7769],
      source: 'GPS',
      accuracy_m: 12,
      captured_at: new Date().toISOString(),
    },
    timeline: [
      {
        event_type: 'INTAKE_SUBMITTED',
        occurred_at: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        public_text_code: 'INTAKE_SUBMITTED',
      },
      {
        event_type: 'VERIFICATION_VERIFIED',
        occurred_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        public_text_code: 'VERIFICATION_VERIFIED',
      },
      {
        event_type: 'MISSION_DISPATCHED',
        occurred_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        public_text_code: 'MISSION_DISPATCHED',
      },
    ],
  },
  {
    id: 'req-mock-02',
    tracking_code: 'SOS5412ABC',
    tracking_secret: 'mock-secret-43chars-base64url-11111111111111',
    reporter_user_id: null, // Khách ẩn danh
    status: 'SUBMITTED',
    version: 1,
    received_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    incident_category_code: 'LANDSLIDE',
    people_affected: 2,
    description: 'Đất đá sạt lở trước ngõ, chưa thể ra ngoài được.',
    location: {
      type: 'Point',
      coordinates: [106.695, 10.772],
      source: 'MANUAL_PIN',
      captured_at: new Date().toISOString(),
    },
    timeline: [
      {
        event_type: 'INTAKE_SUBMITTED',
        occurred_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        public_text_code: 'INTAKE_SUBMITTED',
      },
    ],
  },
];

// Danh sách nhiệm vụ cứu trợ cho đội
const mockMissions: Mission[] = [
  {
    id: 'mis-mock-01',
    request_id: 'req-mock-01',
    team_id: 'team-01',
    team: { id: 'team-01', name: 'Đội Cứu Nạn Cơ Động Số 1' },
    version: 1,
    work_cycle: 1,
    category: 'FLOOD',
    status: 'OFFERED',
    people_affected: 4,
    declared_danger: true,
    reporter_contact_phone: '0987654321',
    beneficiary_contact_phone: '0987654321',
    alternate_contact: {
      name: 'Bác Ba (Hàng xóm)',
      phone: '0901234567',
    },
    description: 'Nước dâng cao gần chạm nóc, trong nhà có người già và trẻ nhỏ.',
    location: {
      type: 'Point',
      coordinates: [106.7009, 10.7769],
      source: 'GPS',
      accuracy_m: 10,
      captured_at: new Date().toISOString(),
    },
    created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    distance_m: 1200,
  },
  {
    id: 'mis-mock-02',
    request_id: 'req-mock-02',
    team_id: 'team-01',
    team: { id: 'team-01', name: 'Đội Cứu Nạn Cơ Động Số 1' },
    version: 2,
    work_cycle: 1,
    category: 'TRAPPED',
    status: 'EN_ROUTE',
    people_affected: 25,
    declared_danger: false,
    reporter_contact_phone: '0912345678',
    beneficiary_contact_phone: '0912345678',
    description: 'Cần canô và mang theo 20 thùng mì, 10 thùng nước tinh khiết.',
    location: {
      type: 'Point',
      coordinates: [106.71, 10.785],
      source: 'MANUAL_PIN',
      captured_at: new Date().toISOString(),
    },
    created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    distance_m: 3500,
  },
];

// Thông tin đội cứu hộ mẫu
const mockRescueTeam: any = {
  id: 'team-01',
  name: 'Đội Cứu Nạn Cơ Động Số 1',
  version: 1,
  availability: 'AVAILABLE',
  team_kind: 'VOLUNTEER',
  kind: 'VOLUNTEER',
  reporting_mode: 'APP',
  operating_region_code: 'VN-48',
  skills: ['FIRST_AID', 'BOAT_RESCUE'],
  position: {
    location: {
      type: 'Point',
      coordinates: [106.705, 10.775],
      source: 'GPS',
      accuracy_m: 15,
      captured_at: new Date().toISOString(),
    },
    age_s: 120,
    accuracy_m: 15,
    source: 'GPS',
  },
};

// Thông báo điều phối khẩn mẫu
const mockNotices: NoticeItem[] = [
  {
    id: 'notice-01',
    notice_type: 'BROADCAST_ALERT',
    payload: {
      title: 'Cảnh báo xả lũ khẩn cấp Hồ Kẻ Gỗ',
      message: 'Từ 06:00 sáng mai dự kiến tăng lưu lượng xả tràn lên 800m3/s. Người dân vùng hạ du sẵn sàng sơ tán lên điểm cao.',
      priority: 'HIGH',
    },
    created_at: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    read_at: null,
  },
  {
    id: 'notice-02',
    notice_type: 'REQUEST_UPDATE',
    payload: {
      title: 'Đội cứu nạn đang trên đường tiếp cận',
      message: 'Ca nô cứu hộ của Đội số 1 đã xuất phát đến vị trí của bạn.',
      request_id: 'req-mock-01',
    },
    created_at: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
    read_at: null,
  },
];

// Danh sách chiến dịch quyên góp mẫu chuẩn Backend
const mockDrives = [
  {
    id: 'drive-01',
    title: 'Tiếp nhận Áo phao & Đèn pin cứu sinh khẩn cấp Đợt 1',
    description: 'Tiếp nhận nhu yếu phẩm phục vụ cứu nạn đồng bào vùng lũ sâu.',
    status: 'OPEN',
    intake_warehouse_name: 'Kho Tiếp Nhận Trung Tâm Đà Nẵng',
    address_note: 'Số 15 Quang Trung, Q. Hải Châu, TP Đà Nẵng',
    intake_location: {
      warehouse_name: 'Kho Tiếp Nhận Trung Tâm Đà Nẵng',
      address_note: 'Số 15 Quang Trung, Q. Hải Châu, TP Đà Nẵng',
      location: {
        type: 'Point',
        coordinates: [108.22, 16.07],
      },
    },
    items: [
      {
        item_id: 'item-01',
        item_name: 'Áo phao cứu sinh người lớn & trẻ em',
        name: 'Áo phao cứu sinh người lớn & trẻ em',
        unit_code: 'PIECE',
        unit_name: 'chiếc',
        target_quantity: '500',
        accepted_total: '120',
      },
      {
        item_id: 'item-02',
        item_name: 'Đèn pin chống nước siêu sáng',
        name: 'Đèn pin chống nước siêu sáng',
        unit_code: 'UNIT',
        unit_name: 'cái',
        target_quantity: '200',
        accepted_total: '85',
      },
      {
        item_id: 'item-03',
        item_name: 'Lương khô quân đội đóng hộp',
        name: 'Lương khô quân đội đóng hộp',
        unit_code: 'BOX',
        unit_name: 'thùng',
        target_quantity: '1000',
        accepted_total: '430',
      },
      {
        item_id: 'item-04',
        item_name: 'Nước uống đóng chai 500ml',
        name: 'Nước uống đóng chai 500ml',
        unit_code: 'CARTON',
        unit_name: 'thùng',
        target_quantity: '2000',
        accepted_total: '1150',
      },
    ],
  },
  {
    id: 'drive-02',
    title: 'Hỗ trợ Túi thuốc sơ cấp cứu & Viên lọc nước Aquatabs',
    description: 'Hỗ trợ y tế và khử khuẩn nguồn nước sinh hoạt cho các xã bị ngập lụt.',
    status: 'OPEN',
    intake_warehouse_name: 'Trạm Tiếp Nhận Y Tế - BV Đa Khoa Khu Vực',
    address_note: 'Km 12 Quốc lộ 1A, Huyện Hòa Vang, Đà Nẵng',
    intake_location: {
      warehouse_name: 'Trạm Tiếp Nhận Y Tế - BV Đa Khoa Khu Vực',
      address_note: 'Km 12 Quốc lộ 1A, Huyện Hòa Vang, Đà Nẵng',
      location: {
        type: 'Point',
        coordinates: [108.18, 16.02],
      },
    },
    items: [
      {
        item_id: 'item-05',
        item_name: 'Túi sơ cấp cứu cá nhân',
        name: 'Túi sơ cấp cứu cá nhân',
        unit_code: 'KIT',
        unit_name: 'bộ',
        target_quantity: '300',
        accepted_total: '95',
      },
      {
        item_id: 'item-06',
        item_name: 'Viên làm sạch nước uống Aquatabs',
        name: 'Viên làm sạch nước uống Aquatabs',
        unit_code: 'BOX',
        unit_name: 'hộp',
        target_quantity: '500',
        accepted_total: '210',
      },
    ],
  },
];

let currentUserSession: MockUser | null = null;

// Hàm giả lập độ trễ mạng (latency) từ 200ms - 400ms để trải nghiệm mượt mà như mạng thật
const delay = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

// Bộ định tuyến giả lập mô phỏng 100% API NestJS Backend
export async function handleMockRequest(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  await delay(200);

  const url = config.url || '';
  const method = (config.method || 'get').toLowerCase();
  const body = typeof config.data === 'string' ? JSON.parse(config.data || '{}') : (config.data || {});
  const headers = config.headers || {};

  // ==================== IDENTITY SERVICE MOCK ====================

  // 1. Đăng ký tài khoản công dân (POST /identity/auth/register)
  if (url.includes('/identity/auth/register') && method === 'post') {
    const existing = mockUsers.find((u) => u.username.toLowerCase() === body.username?.toLowerCase());
    if (existing) {
      throw {
        response: {
          status: 409,
          data: { code: 'USERNAME_TAKEN', message: 'Tên đăng nhập này đã có người sử dụng.' },
        },
      };
    }

    const newUser: MockUser = {
      id: generateUUID(),
      username: body.username,
      display_name: body.display_name,
      password: body.password,
      roles: ['CITIZEN'],
    };
    mockUsers.push(newUser);

    return {
      data: { user: { id: newUser.id, username: newUser.username, display_name: newUser.display_name } },
      status: 201,
      statusText: 'Created',
      headers: {},
      config,
    };
  }

  // 2. Đăng nhập (POST /identity/auth/login)
  if (url.includes('/identity/auth/login') && method === 'post') {
    const user = mockUsers.find(
      (u) => u.username.toLowerCase() === body.username?.toLowerCase() && u.password === body.password
    );

    if (!user) {
      throw {
        response: {
          status: 401,
          data: { code: 'INVALID_CREDENTIALS', message: 'Tên đăng nhập hoặc mật khẩu không chính xác.' },
        },
      };
    }

    currentUserSession = user;
    return {
      data: {
        user: { id: user.id, username: user.username, display_name: user.display_name },
        access_token: `mock-access-token-${user.id}`,
        refresh_token: `mock-refresh-token-${user.id}-43chars-base64url`,
        expires_in: 600,
        must_change_password: false,
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  }

  // 3. Lấy thông tin tài khoản hiện tại (GET /identity/me)
  if (url.includes('/identity/me') && method === 'get') {
    const user = currentUserSession || mockUsers[0];
    return {
      data: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        must_change_password: false,
        grants: user.roles.map((r, i) => ({
          id: `grant-${i}`,
          role_code: r,
          scope_type: 'SYSTEM',
        })),
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  }

  // 4. Đăng xuất (POST /identity/auth/logout)
  if (url.includes('/identity/auth/logout') && method === 'post') {
    currentUserSession = null;
    return { data: { success: true }, status: 200, statusText: 'OK', headers: {}, config };
  }

  // ==================== RESPONSE SERVICE MOCK ====================

  // 5. Gửi SOS tại chỗ / Bản thân (POST /response/requests)
  if (url.includes('/response/requests') && method === 'post' && !url.includes('/proxy') && !url.includes('/claim') && !url.includes('/supplements') && !url.includes('/evidence')) {
    const code = 'SOS' + Math.floor(1000 + Math.random() * 9000) + 'VN';
    const secret = headers['X-Tracking-Secret'] || generateRandomSecret();
    const newReq = {
      id: generateUUID(),
      tracking_code: code,
      tracking_secret: secret as string,
      reporter_user_id: currentUserSession ? currentUserSession.id : null,
      status: 'SUBMITTED' as RequestStatus,
      version: 1,
      received_at: new Date().toISOString(),
      incident_category_code: body.incident_category_code || 'FLOOD',
      people_affected: body.people_affected || 1,
      description: body.description || '',
      location: body.location,
      timeline: [
        {
          event_type: 'INTAKE_SUBMITTED',
          occurred_at: new Date().toISOString(),
          public_text_code: 'INTAKE_SUBMITTED',
        },
      ],
    };
    mockRequests.unshift(newReq);

    return {
      data: {
        id: newReq.id,
        tracking_code: newReq.tracking_code,
        status: newReq.status,
        received_at: newReq.received_at,
        review_lane: 'NORMAL',
      },
      status: 201,
      statusText: 'Created',
      headers: {},
      config,
    };
  }

  // 6. Báo cứu trợ người thân từ xa (POST /response/requests/proxy)
  if (url.includes('/response/requests/proxy') && method === 'post') {
    const code = 'PXY' + Math.floor(1000 + Math.random() * 9000) + 'VN';
    const newReq = {
      id: generateUUID(),
      tracking_code: code,
      tracking_secret: generateRandomSecret(),
      reporter_user_id: currentUserSession ? currentUserSession.id : 'user-citizen-01',
      status: 'SUBMITTED' as RequestStatus,
      version: 1,
      received_at: new Date().toISOString(),
      incident_category_code: body.incident_category_code || 'FLOOD',
      people_affected: body.people_affected || 2,
      description: body.description || '',
      location: body.location,
      timeline: [
        {
          event_type: 'INTAKE_SUBMITTED',
          occurred_at: new Date().toISOString(),
          public_text_code: 'INTAKE_SUBMITTED',
        },
      ],
    };
    mockRequests.unshift(newReq);

    return {
      data: {
        id: newReq.id,
        tracking_code: newReq.tracking_code,
        status: newReq.status,
        received_at: newReq.received_at,
        review_lane: 'NORMAL',
      },
      status: 201,
      statusText: 'Created',
      headers: {},
      config,
    };
  }

  // 7. Tra cứu tiến độ (GET /response/requests/track)
  if (url.includes('/response/requests/track') && method === 'get') {
    const code = (headers['X-Tracking-Code'] as string) || '';
    const found = mockRequests.find(
      (r) => r.tracking_code.toUpperCase() === code.toUpperCase()
    ) || mockRequests[0];

    const detail: RequestTrackingDetail = {
      id: found.id,
      tracking_code: found.tracking_code,
      status: found.status,
      version: found.version,
      received_at: found.received_at,
      timeline: found.timeline,
      can_supplement: true,
      people_affected: found.people_affected,
      description: found.description,
      location: found.location,
    };

    return { data: detail, status: 200, statusText: 'OK', headers: {}, config };
  }

  // 8. Danh sách yêu cầu của tôi (GET /response/requests/mine)
  if (url.includes('/response/requests/mine') && method === 'get') {
    const myId = currentUserSession?.id || 'user-citizen-01';
    const myItems: MyRequestItem[] = mockRequests
      .filter((r) => r.reporter_user_id === myId || !r.reporter_user_id)
      .map((r) => ({
        id: r.id,
        tracking_code: r.tracking_code,
        status: r.status,
        received_at: r.received_at,
      }));

    return {
      data: { items: myItems, more: false },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  }

  // 9. Gắn yêu cầu ẩn danh vào tài khoản (POST /response/requests/claim)
  if (url.includes('/response/requests/claim') && method === 'post') {
    const code = body.tracking_code;
    const req = mockRequests.find((r) => r.tracking_code === code);
    if (req) {
      req.reporter_user_id = currentUserSession?.id || 'user-citizen-01';
    }
    return {
      data: { id: req?.id || generateUUID(), tracking_code: code },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  }

  // 10. Bổ sung thông tin (POST /response/requests/:id/supplements)
  if (url.includes('/supplements') && method === 'post') {
    const match = /\/requests\/([^/]+)\/supplements/.exec(url);
    const reqId = match ? match[1] : '';
    const req = mockRequests.find((r) => r.id === reqId);
    if (req) {
      req.version += 1;
      req.timeline.unshift({
        event_type: 'SUPPLEMENT_RECEIVED',
        occurred_at: new Date().toISOString(),
        public_text_code: 'SUPPLEMENT_RECEIVED',
      });
      if (body.description) {
        req.description = `${req.description} [Cập nhật: ${body.description}]`;
      }
    }
    return { data: { success: true }, status: 201, statusText: 'Created', headers: {}, config };
  }

  // 11. Tải ảnh bằng chứng lên (POST /response/requests/:id/evidence)
  if (url.includes('/evidence') && method === 'post') {
    return {
      data: {
        id: generateUUID(),
        state: 'READY',
        size_bytes: 512000,
        detected_mime: 'image/jpeg',
        created_at: new Date().toISOString(),
      },
      status: 201,
      statusText: 'Created',
      headers: {},
      config,
    };
  }

  // 12. Danh sách nhiệm vụ đội cứu hộ (GET /response/missions/mine)
  if (url.includes('/response/missions/mine') && method === 'get') {
    return { data: { items: mockMissions, more: false }, status: 200, statusText: 'OK', headers: {}, config };
  }

  // 13. Chi tiết nhiệm vụ (GET /response/missions/:id)
  if (url.match(/\/response\/missions\/[^/]+$/) && method === 'get') {
    const id = url.split('/').pop();
    const mission = mockMissions.find((m) => m.id === id) || mockMissions[0];
    return { data: mission, status: 200, statusText: 'OK', headers: {}, config };
  }

  // 14. Tiếp nhận nhiệm vụ (POST /response/missions/:id/accept)
  if (url.includes('/accept') && method === 'post') {
    const id = url.split('/')[url.split('/').length - 2];
    const mission = mockMissions.find((m) => m.id === id);
    if (mission) {
      mission.status = 'ACCEPTED';
      mission.version = (mission.version || 1) + 1;
    }
    return { data: { success: true }, status: 200, statusText: 'OK', headers: {}, config };
  }

  // 15. Từ chối nhiệm vụ (POST /response/missions/:id/decline)
  if (url.includes('/decline') && method === 'post') {
    const id = url.split('/')[url.split('/').length - 2];
    const mission = mockMissions.find((m) => m.id === id);
    if (mission) {
      mission.status = 'DECLINED';
      mission.version = (mission.version || 1) + 1;
    }
    return { data: { success: true }, status: 200, statusText: 'OK', headers: {}, config };
  }

  // 16. Cập nhật bước tiến độ nhiệm vụ (POST /response/missions/:id/transition)
  if (url.includes('/transition') && method === 'post') {
    const id = url.split('/')[url.split('/').length - 2];
    const mission = mockMissions.find((m) => m.id === id);
    if (mission) {
      const targetStatus = body.to || body.to_status;
      if (targetStatus) mission.status = targetStatus;
      mission.version = (mission.version || 1) + 1;
    }
    return { data: { success: true }, status: 200, statusText: 'OK', headers: {}, config };
  }

  // 17. Tải ảnh bằng chứng cứu nạn của Đội cứu hộ (POST /response/missions/:id/evidence)
  if (url.includes('/response/missions') && url.includes('/evidence') && method === 'post') {
    return {
      data: {
        id: generateUUID(),
        state: 'READY',
        size_bytes: 768000,
        detected_mime: 'image/jpeg',
        created_at: new Date().toISOString(),
      },
      status: 201,
      statusText: 'Created',
      headers: {},
      config,
    };
  }

  // 18. Lấy danh sách đội cứu hộ (GET /response/teams)
  if (url.includes('/response/teams') && method === 'get') {
    return { data: [mockRescueTeam], status: 200, statusText: 'OK', headers: {}, config };
  }

  // 19. Phát tọa độ GPS di quân của đội (PUT /response/teams/:id/position)
  if (url.includes('/response/teams') && url.includes('/position') && (method === 'put' || method === 'post')) {
    if (body.location?.coordinates) {
      mockRescueTeam.position = {
        location: body.location,
        accuracy_m: body.accuracy_m || 10,
        captured_at: body.captured_at || new Date().toISOString(),
        age_s: 0,
        source: 'GPS',
      };
    }
    return { data: { success: true }, status: 200, statusText: 'OK', headers: {}, config };
  }

  // 20. Cập nhật trạng thái sẵn sàng của đội (PATCH /response/teams/:id)
  if (url.includes('/response/teams') && method === 'patch') {
    if (body.availability) {
      mockRescueTeam.availability = body.availability;
      mockRescueTeam.version = (mockRescueTeam.version || 1) + 1;
    }
    return { data: mockRescueTeam, status: 200, statusText: 'OK', headers: {}, config };
  }

  // 21. Lấy thông báo khẩn cấp (GET /response/notices)
  if (url.includes('/response/notices') && method === 'get') {
    return { data: { items: mockNotices, more: false }, status: 200, statusText: 'OK', headers: {}, config };
  }

  // 22. Đánh dấu đã đọc thông báo (POST /response/notices/:id/read)
  if (url.includes('/response/notices') && url.includes('/read') && method === 'post') {
    const noticeId = url.split('/')[url.split('/').length - 2];
    const n = mockNotices.find((item) => item.id === noticeId);
    if (n) n.read_at = new Date().toISOString();
    return { data: { id: noticeId, read_at: new Date().toISOString() }, status: 200, statusText: 'OK', headers: {}, config };
  }

  // 23. Danh sách chiến dịch mở công khai (GET /response/public/campaigns)
  if (url.includes('/response/public/campaigns') && method === 'get') {
    return {
      data: {
        items: [
          {
            id: 'camp-01',
            title: 'Chiến dịch Khắc phục Hậu quả Lũ lụt Miền Trung 2026',
            description: 'Toàn dân đồng lòng hướng về đồng bào vùng lũ.',
            status: 'ACTIVE',
            region_code: 'VN-48',
            created_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
          },
        ],
        more: false,
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  }

  // ==================== LOGISTICS SERVICE MOCK ====================

  // 24. Các đợt tiếp nhận hiện vật mở công khai (GET /logistics/public/donation-drives)
  if (url.includes('/logistics/public/donation-drives') && method === 'get') {
    if (url.match(/\/donation-drives\/[^/]+$/)) {
      const id = url.split('/').pop();
      const drive = mockDrives.find((d) => d.id === id) || mockDrives[0];
      return { data: drive, status: 200, statusText: 'OK', headers: {}, config };
    }
    return { data: mockDrives, status: 200, statusText: 'OK', headers: {}, config };
  }

  // 25. Khai báo quyên góp bàn giao (POST /logistics/public/donation-drives/:id/deliveries)
  if (url.includes('/logistics/public/donation-drives') && url.includes('/deliveries') && method === 'post') {
    const code = 'DN' + Math.floor(1000 + Math.random() * 9000);
    return {
      data: {
        id: generateUUID(),
        public_code: code,
        status: 'DECLARED',
        declaration_revision: 1,
      },
      status: 201,
      statusText: 'Created',
      headers: {},
      config,
    };
  }

  // 26. Tra cứu tiến độ quyên góp (GET /logistics/public/donations/:id)
  if (url.includes('/logistics/public/donations') && method === 'get') {
    const donationId = url.split('/').pop() || '';
    return {
      data: {
        id: donationId,
        public_code: 'DN8899',
        status: 'COUNTING',
        declaration: {
          revision: 1,
          lines: [
            { item_name: 'Áo phao cứu sinh người lớn & trẻ em', unit_name: 'chiếc', declared_quantity: '50' },
            { item_name: 'Đèn pin chống nước siêu sáng', unit_name: 'cái', declared_quantity: '20' },
          ],
        },
        receipt: {
          count_revision: 1,
          lines: [
            {
              item_name: 'Áo phao cứu sinh người lớn & trẻ em',
              unit_name: 'chiếc',
              declared_quantity: '50',
              counted_quantity: '50',
              accepted_quantity: '48',
              rejected_quantity: '2',
              condition_note: '2 chiếc bị rách dây đai khóa an toàn',
            },
          ],
        },
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  }

  // Default fallback
  return { data: { message: 'Thành công (Chế độ giả lập)' }, status: 200, statusText: 'OK', headers: {}, config };
}
