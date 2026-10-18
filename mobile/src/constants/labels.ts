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
