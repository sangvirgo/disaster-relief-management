// Từ điển hiển thị tiếng Việt chuẩn hóa cho toàn bộ ứng dụng Mobile C48
import { IncidentCategoryCode, RequestStatus, MissionStatus, PriorityLevel } from '../types/api';

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
  ISOLATED: {
    label: 'Cô lập thiếu đói',
    icon: 'Compass',
    desc: 'Hết lương thực, nước uống, không có đường ra',
  },
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
  EN_ROUTE: { label: 'Đang di chuyển đến hiện trường', color: '#0284C7', bg: '#F0F9FF' },
  ON_SCENE: { label: 'Đã tiếp cận vị trí nạn nhân', color: '#7C3AED', bg: '#F5F3FF' },
  COMPLETED: { label: 'Hoàn thành cứu nạn thành công', color: '#16A34A', bg: '#DCFCE7' },
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
  INTERMITTENT: 'Sóng chập chờn, lúc được lúc mất',
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
    title: 'Đã điều phối đội cứu hộ tiếp cận',
    desc: 'Đã lựa chọn đội cứu hộ cơ động gần nhất và trang thiết bị phù hợp.',
  },
  MISSION_ACCEPTED: {
    title: 'Đội cứu hộ đã tiếp nhận lệnh',
    desc: 'Đội trưởng đã xác nhận xuất kích đến vị trí của bạn.',
  },
  MISSION_EN_ROUTE: {
    title: 'Đội cứu hộ đang di chuyển đến hiện trường',
    desc: 'Phương tiện cứu trợ (ca nô/xuồng/xe lội nước) đang trên đường tới.',
  },
  MISSION_ON_SCENE: {
    title: 'Đội cứu hộ đã tiếp cận vị trí của bạn',
    desc: 'Lực lượng cứu hộ đang triển khai ứng cứu trực tiếp tại chỗ.',
  },
  REQUEST_RESOLVED: {
    title: 'Cứu nạn hoàn tất thành công',
    desc: 'Nạn nhân đã được đưa về nơi an toàn hoặc nhận đầy đủ hàng cứu trợ.',
  },
  SUPPLEMENT_RECEIVED: {
    title: 'Đã ghi nhận thông tin & bằng chứng bổ sung',
    desc: 'Điều phối viên và đội cứu nạn đã nhận được ghi chú/ảnh hiện trường mới.',
  },
  REQUEST_DUPLICATED: {
    title: 'Gộp vào hồ sơ cứu nạn gốc',
    desc: 'Yêu cầu của bạn được xử lý chung cùng hồ sơ cứu nạn tại cùng điểm ngập.',
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

  const explicitTitle = typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : '';
  const explicitMessage = typeof payload.message === 'string' && payload.message.trim() ? payload.message.trim() : '';

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
    REQUEST_DISPATCHED: {
      title: 'Đang Điều Phối Đội Cứu Nạn',
      message: 'Lệnh điều động đã được phát đi. Đội cứu hộ gần vị trí của bạn nhất đang chuẩn bị xuất phát.',
      isUrgent: true,
    },
    REQUEST_IN_PROGRESS: {
      title: 'Đội Cứu Hộ Đang Đến Hiện Trường',
      message: 'Lực lượng cứu hộ đang trên đường di chuyển và tiếp cận điểm cứu nạn của bạn. Vui lòng giữ liên lạc và tiết kiệm pin!',
      isUrgent: true,
    },
    REQUEST_RESOLVED: {
      title: 'Nhiệm Vụ Cứu Hộ Hoàn Tất',
      message: 'Công tác ứng cứu và cứu trợ đối với hồ sơ của bạn đã được thực hiện thành công và hoàn tất an toàn.',
    },
    REQUEST_CLOSED: {
      title: 'Hồ Sơ Cứu Hộ Đã Đóng',
      message: 'Hồ sơ yêu cầu cứu nạn của bạn đã kết thúc toàn bộ quy trình xử lý trên hệ thống.',
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
      title: 'Đội Cứu Hộ Đã Nhận Nhiệm Vụ',
      message: 'Đội trưởng đội cứu trợ đã xác nhận tiếp nhận nhiệm vụ và bắt đầu triển khai phương án.',
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
      title: 'Nhiệm Vụ Cứu Nạn Hoàn Thành',
      message: 'Đội cứu hộ đã đưa nạn nhân đến vị trí an toàn hoặc cấp phát xong nhu yếu phẩm cần thiết.',
    },
    REPORTER_SUPPLEMENT: {
      title: 'Ghi Nhận Thông Tin Bổ Sung',
      message: 'Ghi chú và hình ảnh hiện trường mới của bạn đã được cập nhật thành công vào hồ sơ theo dõi.',
    },
  };

  const matched = NOTICES_MAP[code];
  const finalTitle = explicitTitle || matched?.title || 'Thông Báo Cứu Trợ';
  let finalMessage = explicitMessage || matched?.message;

  if (!finalMessage) {
    if (code) {
      finalMessage = `Hệ thống ghi nhận sự kiện cập nhật tiến độ: ${code}. Ban chỉ huy đang tiếp tục giám sát xử lý.`;
    } else {
      finalMessage = 'Bạn có thông báo mới từ trung tâm điều phối cứu trợ.';
    }
  }

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
