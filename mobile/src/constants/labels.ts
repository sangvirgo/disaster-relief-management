import { RequestStatus, MissionStatus, PriorityLevel } from '../types/api';

// Phân loại lực lượng cứu hộ
export const RESCUE_TEAM_KIND_LABELS: Record<string, string> = {
  VOLUNTEER: 'Tình nguyện viên chuyên nghiệp',
  MILITARY: 'Lực lượng vũ trang / Quân đội',
  GOVERNMENT: 'Ban chỉ huy PCTT & TKCN',
  OTHER: 'Lực lượng cứu nạn dân sự',
};

// Kỹ năng chuyên môn của đội cứu nạn
export const RESCUE_SKILL_LABELS: Record<string, string> = {
  BOAT: 'Điều khiển xuồng / thuyền cứu hộ',
  FIRST_AID: 'Sơ cấp cứu y tế',
  CLIMBING: 'Cứu hộ leo trèo / địa hình',
  TRUCK_DRIVER: 'Lái xe tải vượt lũ',
  RADIO: 'Thông tin liên lạc vô tuyến',
};

// Từ điển hiển thị tiếng Việt chuẩn hóa cho toàn bộ ứng dụng Reliva.

export const INCIDENT_CATEGORIES: Record<string, { label: string; icon: string; desc: string }> = {
  FLOOD: {
    label: 'Lũ lụt dâng cao',
    icon: 'Waves',
    desc: 'Nước dâng nhanh, ngập nóc nhà, cô lập hoàn toàn',
  },
  TRAPPED: {
    label: 'Người bị mắc kẹt',
    icon: 'Compass',
    desc: 'Mắc kẹt trên mái nhà, cây cao, trong nhà sập không lối thoát',
  },
  LANDSLIDE: {
    label: 'Sạt lở đất đá',
    icon: 'Mountain',
    desc: 'Núi lở, đất đá sụp đổ vùi lấp đường sá, nhà cửa',
  },
  STORM: {
    label: 'Bão & Gió lốc',
    icon: 'CloudLightning',
    desc: 'Gió giật mạnh làm sập nhà, tốc mái, gãy đổ nguy hiểm',
  },
  MEDICAL: {
    label: 'Cấp cứu y tế',
    icon: 'HeartPulse',
    desc: 'Có người bị thương nặng, sinh nở, tai biến nguy cấp',
  },
  FIRE: {
    label: 'Cháy & Hỏa hoạn',
    icon: 'Flame',
    desc: 'Cháy nhà, cháy rừng, nổ bình gas trong bão lũ',
  },
  SUPPLY_SHORTAGE: {
    label: 'Thiếu lương thực, nước',
    icon: 'Package',
    desc: 'Hết thức ăn, nước uống, thuốc men nhiều ngày',
  },
  OTHER: {
    label: 'Sự cố nguy cấp khác',
    icon: 'AlertTriangle',
    desc: 'Tình huống nguy hiểm khẩn cấp cần cứu nạn ngay',
  },
  UNKNOWN: {
    label: 'Chưa rõ tình hình',
    icon: 'AlertCircle',
    desc: 'Cần xác minh thêm thông tin hiện trường',
  },
};

// Phân loại hình thức nhiệm vụ cứu trợ
export const MISSION_KIND_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  RESCUE: { label: 'Cứu nạn khẩn cấp', color: '#DC2626', bg: '#FEE2E2' },
  DELIVERY: { label: 'Tiếp tế cứu trợ', color: '#2563EB', bg: '#EFF6FF' },
  COMBINED: { label: 'Cứu nạn & Tiếp tế kết hợp', color: '#7C3AED', bg: '#F5F3FF' },
};

export const REQUEST_STATUS_LABELS: Record<RequestStatus, { label: string; color: string; bg: string }> = {
  SUBMITTED: { label: 'Đã gửi - Chờ tiếp nhận', color: '#64748B', bg: '#F1F5F9' },
  VERIFYING: { label: 'Đang xác minh thông tin', color: '#D97706', bg: '#FEF3C7' },
  VERIFIED: { label: 'Đã xác minh chính xác', color: '#2563EB', bg: '#EFF6FF' },
  REJECTED: { label: 'Từ chối tiếp nhận', color: '#DC2626', bg: '#FEF2F2' },
  DUPLICATE: { label: 'Yêu cầu trùng lặp', color: '#64748B', bg: '#F8FAFC' },
  TRIAGED: { label: 'Đã phân loại ưu tiên', color: '#7C3AED', bg: '#F5F3FF' },
  DISPATCHED: { label: 'Đang điều phối đội cứu hộ', color: '#EA580C', bg: '#FFF7ED' },
  IN_PROGRESS: { label: 'Đội cứu hộ đang ứng cứu', color: '#0284C7', bg: '#F0F9FF' },
  RESOLVING: { label: 'Đang chốt nghiệm thu', color: '#059669', bg: '#ECFDF5' },
  RESOLVED: { label: 'Cứu hộ hoàn tất thành công', color: '#16A34A', bg: '#DCFCE7' },
  CLOSED: { label: 'Hồ sơ đã đóng', color: '#475569', bg: '#E2E8F0' },
  CANCELLED: { label: 'Đã hủy bỏ', color: '#94A3B8', bg: '#F1F5F9' },
};

export const MISSION_STATUS_LABELS: Record<MissionStatus, { label: string; color: string; bg: string }> = {
  OFFERED: { label: 'Nhiệm vụ mới nhận', color: '#D97706', bg: '#FEF3C7' },
  ACCEPTED: { label: 'Đã tiếp nhận nhiệm vụ', color: '#2563EB', bg: '#EFF6FF' },
  DECLINED: { label: 'Đã từ chối nhiệm vụ', color: '#DC2626', bg: '#FEF2F2' },
  EN_ROUTE: { label: 'Đang di chuyển đến điểm nhiệm vụ', color: '#0284C7', bg: '#F0F9FF' },
  ON_SCENE: { label: 'Đã tiếp cận điểm nhiệm vụ', color: '#7C3AED', bg: '#F5F3FF' },
  COMPLETED: { label: 'Đã hoàn thành nhiệm vụ', color: '#16A34A', bg: '#DCFCE7' },
  FAILED: { label: 'Gặp trở ngại / Thất bại', color: '#EF4444', bg: '#FEE2E2' },
  CANCELLED: { label: 'Nhiệm vụ đã bị hủy', color: '#64748B', bg: '#F1F5F9' },
};

export const PRIORITY_LABELS: Record<PriorityLevel, { label: string; color: string; bg: string; badge: string }> = {
  P1: { label: 'Khẩn cấp - Nguy cơ tính mạng tức thời', color: '#DC2626', bg: '#FEE2E2', badge: 'P1 - Khẩn cấp' },
  P2: { label: 'Nguy cấp - Cần trợ giúp trong vài giờ', color: '#EA580C', bg: '#FFEDD5', badge: 'P2 - Nguy cấp' },
  P3: { label: 'Cần hỗ trợ - Tình hình ổn định', color: '#CA8A04', bg: '#FEF9C3', badge: 'P3 - Hỗ trợ' },
  P4: { label: 'Thông tin / Không khẩn cấp', color: '#16A34A', bg: '#DCFCE7', badge: 'P4 - Ít khẩn' },
};

export const CONTACTABILITY_LABELS = {
  REACHABLE: 'Có thể liên lạc được qua điện thoại',
  UNREACHABLE: 'Mất sóng hoàn toàn / Hết pin',
  UNKNOWN: 'Chưa rõ tình trạng liên lạc',
};

export const TIMELINE_EVENT_LABELS: Record<string, { title: string; desc: string }> = {
  RECEIVED: {
    title: 'Hệ thống đã tiếp nhận tin báo cứu hộ',
    desc: 'Đã ghi nhận tọa độ GPS và chuyển hồ sơ vào trung tâm điều phối.',
  },
  REQUEST_VERIFYING: {
    title: 'Điều phối viên đang thẩm định & xác minh',
    desc: 'Đang kiểm tra thông tin liên lạc và mức độ nguy cấp tại hiện trường.',
  },
  VERIFICATION_STARTED: {
    title: 'Bắt đầu quy trình xác minh thực địa',
    desc: 'Điều phối viên phụ trách khu vực đã tiếp nhận hồ sơ.',
  },
  REQUEST_VERIFIED: {
    title: 'Đã xác minh chính xác hiện trường',
    desc: 'Hồ sơ đã được phê duyệt hợp lệ để lên phương án cứu trợ.',
  },
  REQUEST_TRIAGED: {
    title: 'Đã xếp mức độ ưu tiên cứu hộ',
    desc: 'Trung tâm đã đánh giá độ khẩn và chuẩn bị chỉ định lực lượng ứng cứu.',
  },
  MISSION_DISPATCHED: {
    title: 'Đã điều phối đội thực hiện nhiệm vụ',
    desc: 'Hồ sơ đã được chuyển đến bước điều phối. Theo dõi các cập nhật tiếp theo tại đây.',
  },
  MISSION_ACCEPTED: {
    title: 'Đội phụ trách đã tiếp nhận nhiệm vụ',
    desc: 'Đội trưởng đã xác nhận sẽ triển khai đến địa điểm được giao.',
  },
  MISSION_EN_ROUTE: {
    title: 'Đội phụ trách đang di chuyển',
    desc: 'Đội thực hiện đang trên đường đến địa điểm nhiệm vụ.',
  },
  MISSION_ON_SCENE: {
    title: 'Đội phụ trách đã đến địa điểm nhiệm vụ',
    desc: 'Đội thực hiện đang triển khai công việc tại địa điểm được giao.',
  },
  MISSION_COMPLETED: {
    title: 'Đội thực hiện đã báo cáo hoàn thành nhiệm vụ',
    desc: 'Trung tâm điều phối đang ghi nhận kết quả xử lý tại hiện trường.',
  },
  MISSION_DECLINED: {
    title: 'Đội cứu hộ đã từ chối nhiệm vụ',
    desc: 'Điều phối viên sẽ xem xét lý do và cập nhật phương án xử lý.',
  },
  MISSION_FAILED: {
    title: 'Đội cứu hộ báo không thể hoàn thành nhiệm vụ',
    desc: 'Điều phối viên sẽ xem xét trở ngại và cập nhật phương án tiếp theo.',
  },
  MISSION_CANCELLED: {
    title: 'Nhiệm vụ của đội đã bị hủy',
    desc: 'Trạng thái yêu cầu cứu trợ được cập nhật bởi trung tâm điều phối.',
  },
  REQUEST_RESOLVED: {
    title: 'Hồ sơ đã được đánh dấu hoàn tất',
    desc: 'Xem thông tin kết quả được ghi nhận trong hồ sơ cứu trợ.',
  },
  REQUEST_CANCELLED: {
    title: 'Yêu cầu đã được hủy',
    desc: 'Trung tâm điều phối đã ghi nhận yêu cầu dừng xử lý. Liên hệ điều phối viên nếu thông tin này chưa chính xác.',
  },
  REQUEST_CLOSED: {
    title: 'Hồ sơ đã đóng',
    desc: 'Quy trình xử lý hồ sơ này đã kết thúc.',
  },
  SUPPLEMENT_RECEIVED: {
    title: 'Đã ghi nhận thông tin & bằng chứng bổ sung',
    desc: 'Điều phối viên và đội cứu nạn đã nhận được ghi chú/ảnh hiện trường mới.',
  },
  REQUEST_DUPLICATED: {
    title: 'Gộp vào hồ sơ cứu nạn gốc',
    desc: 'Yêu cầu của bạn được xử lý chung cùng hồ sơ cứu nạn tại cùng điểm ngập.',
  },
  DUPLICATE_ORPHANED: {
    title: 'Hồ sơ được chuyển sang xác minh riêng',
    desc: 'Hồ sơ gốc đã thay đổi trạng thái. Điều phối viên sẽ xem xét lại yêu cầu này độc lập.',
  },
  REQUEST_REJECTED: {
    title: 'Yêu cầu không thuộc diện cứu nạn khẩn cấp',
    desc: 'Điều phối viên đã xem xét và ghi chú lý do từ chối.',
  },
  REQUEST_CLAIMED: {
    title: 'Đã liên kết hồ sơ vào tài khoản công dân',
    desc: 'Hồ sơ cứu hộ đã được gắn chính thức vào tài khoản cá nhân của bạn.',
  },
};

// Hàm định dạng thông báo tiếng Việt thân thiện, loại bỏ hoàn toàn JSON kỹ thuật
export function formatNoticeDisplay(notice: any): {
  title: string;
  message: string;
  requestId?: string;
  isUrgent?: boolean;
} {
  if (!notice) {
    return { title: 'Thông Báo Cứu Trợ', message: 'Không có chi tiết thông báo.' };
  }

  const payload = notice.payload || {};
  const code = (
    payload.text_code ||
    notice.notice_type ||
    payload.event_type ||
    notice.type ||
    ''
  ).toUpperCase();

  const requestId = payload.request_id || payload.requestId || notice.request_id;
  const shortId = requestId ? String(requestId).slice(0, 8).toUpperCase() : '';

  const NOTICES_MAP: Record<string, { title: string; message: string; isUrgent?: boolean }> = {
    REQUEST_SUBMITTED: {
      title: 'Đã Tiếp Nhận Hồ Sơ Cứu Hộ',
      message: 'Hệ thống đã tiếp nhận yêu cầu cứu trợ của bạn và chuyển đến trung tâm điều phối khu vực.',
    },
    REQUEST_VERIFYING: {
      title: 'Điều Phối Viên Đang Xác Minh',
      message: 'Hồ sơ đang được nhân sự điều phối thẩm định dữ kiện và kiểm tra liên lạc hiện trường.',
    },
    REQUEST_VERIFIED: {
      title: 'Hồ Sơ Đã Được Xác Minh',
      message: 'Hồ sơ cứu trợ của bạn đã được xác minh thành công và chuyển sang khâu xếp mức ưu tiên.',
    },
    REQUEST_TRIAGED: {
      title: 'Đã Xếp Mức Độ Ưu Tiên Ứng Cứu',
      message: 'Ban chỉ huy cứu trợ đã đánh giá mức độ khẩn cấp và đang sắp xếp đội cứu nạn cơ động phù hợp để triển khai.',
    },
    REQUEST_DUPLICATED: {
      title: 'Yêu Cầu Được Liên Kết Với Hồ Sơ Gốc',
      message: 'Điều phối viên đã liên kết tin báo này với hồ sơ cứu nạn liên quan. Hãy theo dõi tiến trình tại hồ sơ đang được xử lý.',
    },
    REQUEST_DISPATCHED: {
      title: 'Đang Điều Phối Đội Cứu Nạn',
      message: 'Hồ sơ đã được chuyển đến bước điều phối. Trung tâm sẽ cập nhật khi có thay đổi.',
      isUrgent: true,
    },
    REQUEST_IN_PROGRESS: {
      title: 'Nhiệm Vụ Cứu Trợ Đang Được Triển Khai',
      message: 'Hãy theo dõi trạng thái và giữ điện thoại sẵn sàng liên lạc.',
      isUrgent: true,
    },
    REQUEST_RESOLVED: {
      title: 'Hồ Sơ Đã Được Đánh Dấu Hoàn Tất',
      message: 'Xem thông tin kết quả được ghi nhận trong hồ sơ cứu trợ.',
    },
    REQUEST_CLOSED: {
      title: 'Hồ Sơ Cứu Hộ Đã Đóng',
      message: 'Hồ sơ yêu cầu cứu nạn của bạn đã kết thúc toàn bộ quy trình xử lý trên hệ thống.',
    },
    REQUEST_CANCELLED: {
      title: 'Yêu Cầu Đã Được Hủy',
      message: 'Trung tâm điều phối đã ghi nhận yêu cầu dừng xử lý hồ sơ này.',
    },
    REQUEST_REOPENED: {
      title: 'Hồ Sơ Được Mở Lại',
      message: 'Hồ sơ đã được chuyển lại để tiếp tục xử lý. Vui lòng theo dõi các cập nhật mới.',
    },
    REQUEST_STATUS_CHANGED: {
      title: 'Hồ Sơ Có Cập Nhật Mới',
      message: 'Trạng thái hồ sơ cứu trợ đã thay đổi. Mở trang theo dõi để xem thông tin mới nhất.',
    },
    DUPLICATE_ORPHANED: {
      title: 'Hồ Sơ Được Xem Xét Riêng',
      message: 'Hồ sơ gốc đã thay đổi trạng thái; yêu cầu này sẽ được điều phối viên xem xét độc lập.',
    },
    REQUEST_REJECTED: {
      title: 'Thông Báo Về Yêu Cầu Cứu Trợ',
      message: 'Hồ sơ chưa đủ điều kiện tiếp nhận cứu nạn khẩn cấp hoặc không liên lạc được với người báo sau nhiều lần thử.',
    },
    REQUEST_OVERDUE: {
      title: 'Cảnh Báo Quá Hạn Xử Lý',
      message: 'Hồ sơ yêu cầu đang được đôn đốc chuyển tiếp để đội cứu hộ xử lý khẩn trương nhất.',
      isUrgent: true,
    },
    MISSION_OFFERED: {
      title: 'Nhiệm Vụ Cứu Hộ Mới',
      message: 'Đội của bạn vừa nhận được lời mời tham gia nhiệm vụ cứu hộ khẩn cấp. Vui lòng phản hồi sớm.',
      isUrgent: true,
    },
    MISSION_ASSIGNED: {
      title: 'Phân Công Nhiệm Vụ Mới',
      message: 'Ban điều phối đã chính thức phân công nhiệm vụ cứu trợ cho đội của bạn.',
      isUrgent: true,
    },
    MISSION_ACCEPTED: {
      title: 'Đội Cứu Hộ Đã Tiếp Nhận Nhiệm Vụ',
      message: 'Hệ thống đã ghi nhận đội cứu hộ tiếp nhận nhiệm vụ.',
    },
    MISSION_EN_ROUTE: {
      title: 'Đội Cứu Hộ Đang Di Chuyển',
      message: 'Phương tiện cứu trợ (xuồng máy/xe lội nước) đang trên lộ trình tiếp cận hiện trường.',
      isUrgent: true,
    },
    MISSION_ON_SCENE: {
      title: 'Đội Cứu Hộ Đã Đến Vị Trí',
      message: 'Lực lượng cứu nạn đã có mặt tại điểm ghim và bắt đầu công tác ứng cứu trực tiếp.',
      isUrgent: true,
    },
    MISSION_COMPLETED: {
      title: 'Nhiệm Vụ Được Ghi Nhận Hoàn Thành',
      message: 'Xem thông tin kết quả do đội cứu hộ ghi nhận trong hồ sơ.',
    },
    REPORTER_SUPPLEMENT: {
      title: 'Ghi Nhận Thông Tin Bổ Sung',
      message: 'Ghi chú và hình ảnh hiện trường mới của bạn đã được cập nhật thành công vào hồ sơ theo dõi.',
    },
    SUPPLEMENT_ACCEPT: {
      title: 'Thông Tin Bổ Sung Đã Được Chấp Nhận',
      message: 'Điều phối viên đã xem xét và cập nhật thông tin bổ sung vào hồ sơ cứu trợ.',
    },
    SUPPLEMENT_REJECT: {
      title: 'Thông Tin Bổ Sung Chưa Được Chấp Nhận',
      message: 'Thông tin mới chưa được dùng để thay đổi dữ kiện đã xác minh. Mở trang theo dõi để xem tiến trình hiện tại.',
    },
    MISSION_OFFER_OVERDUE: {
      title: 'Lời Mời Nhiệm Vụ Chưa Được Phản Hồi',
      message: 'Lời mời nhiệm vụ đang chờ phản hồi. Vui lòng kiểm tra danh sách nhiệm vụ của đội.',
      isUrgent: true,
    },
  };

  const matched = NOTICES_MAP[code];
  const finalTitle = matched?.title || 'Thông Báo Cứu Trợ';
  let finalMessage = matched?.message || 'Bạn có cập nhật mới từ trung tâm điều phối cứu trợ.';

  if (shortId) {
    finalMessage += `\n\n(Mã hồ sơ: #${shortId})`;
  }

  return {
    title: finalTitle,
    message: finalMessage,
    requestId: requestId ? String(requestId) : undefined,
    isUrgent: matched?.isUrgent || false,
  };
}
