// Vietnamese copy for supply gaps, campaign warehouses and norms. Codes stay English for the API; clients branch on codes.
// These maps are separate from labels.ts on purpose: some codes (for example ACCEPTED, OPEN) mean something else there.
import type { BadgeTone } from '../components/ui/Badge';

export const supplyGapStatusLabels: Record<string, string> = {
  OPEN: 'Đang chờ xử lý',
  ACCEPTED: 'Đã tạo đợt quyên góp',
  DISMISSED: 'Đã bỏ qua',
  EXPIRED: 'Đã hết hiệu lực',
};

export const supplyGapStatusTones: Record<string, BadgeTone> = {
  OPEN: 'warning',
  ACCEPTED: 'success',
  DISMISSED: 'neutral',
  EXPIRED: 'neutral',
};

export const supplyGapStatusOptions = [
  { value: 'OPEN', label: 'Đang chờ xử lý' },
  { value: 'ACCEPTED', label: 'Đã tạo đợt quyên góp' },
  { value: 'DISMISSED', label: 'Đã bỏ qua' },
  { value: 'EXPIRED', label: 'Đã hết hiệu lực' },
] as const;

export const severityLabels: Record<string, string> = {
  RED: 'Đỏ',
  YELLOW: 'Vàng',
};

export const severityTones: Record<string, BadgeTone> = {
  RED: 'danger',
  YELLOW: 'warning',
};

export const severityDescriptions: Record<string, string> = {
  RED: 'Thiếu hàng: nhu cầu lớn hơn nguồn hàng khả dụng và số lượng quyên góp còn lại. Có thể tạo đợt quyên góp nháp để quản lý duyệt.',
  YELLOW: 'Sắp thiếu: nhu cầu gần bằng nguồn hàng. Chỉ là cảnh báo để theo dõi, hệ thống không tạo đợt quyên góp từ mức này.',
};

export const needSourceLabels: Record<string, string> = {
  DECLARED: 'Khai báo',
  ESTIMATED: 'Ước tính',
  CONFIRMED: 'Đã xác nhận',
};

export const needSourceTones: Record<string, BadgeTone> = {
  DECLARED: 'neutral',
  ESTIMATED: 'info',
  CONFIRMED: 'success',
};

export const needSourceDescriptions: Record<string, string> = {
  DECLARED: 'Nhu cầu do người nhập khai báo trực tiếp.',
  ESTIMATED: 'Nhu cầu ước tính từ định mức. Chưa được tính vào cam kết xuất kho cho đến khi được xác nhận.',
  CONFIRMED: 'Nhu cầu ước tính đã được điều phối viên xác nhận.',
};

// Copy matches the backend NEED_REASON_COPY. Only the code is returned by the need read model.
export const needReasonLabels: Record<string, string> = {
  NORM_PER_PERSON_DAY: 'Tính theo định mức mỗi người mỗi ngày, nhân với số ngày.',
  NORM_PER_PERSON: 'Tính theo định mức mỗi người, dùng một lần (không nhân theo số ngày).',
  DAYS_DEFAULT: 'Chưa nhập số ngày, hệ thống dùng mặc định 3 ngày.',
  INFANT_MODIFIER_APPLIED: 'Đã cộng thêm định mức cho trẻ nhỏ.',
  ELDERLY_MODIFIER_APPLIED: 'Đã cộng thêm định mức cho người cao tuổi.',
  ROUNDED_UP_TO_UNIT_SCALE: 'Đã làm tròn lên theo đơn vị tính của vật phẩm.',
  NORM_NOT_FOUND: 'Chưa có định mức đang hoạt động cho nhóm hàng này.',
  QUANTITY_FAR_ABOVE_ESTIMATE: 'Số lượng khai báo lớn hơn 3 lần số ước tính. Hãy kiểm tra lại trước khi xác nhận.',
};

export const campaignWarehouseRoleLabels: Record<string, string> = {
  PRIMARY: 'Kho chính',
  BACKUP: 'Kho dự phòng',
};

export const campaignWarehouseSourceLabels: Record<string, string> = {
  AUTO: 'Tự động',
  MANUAL: 'Chọn thủ công',
};

export const assignmentFlagLabels: Record<string, string> = {
  NO_SERVING_WAREHOUSE: 'Chưa có kho nào đủ điều kiện phục vụ chiến dịch này.',
  MANUAL_PRIMARY_INELIGIBLE: 'Kho chính được chọn thủ công hiện không đủ điều kiện phục vụ. Hãy chọn kho khác hoặc tính lại.',
  CAMPAIGN_AREA_MISSING: 'Chiến dịch chưa có vùng phục vụ (tâm và bán kính), nên chưa thể gán kho.',
};

export const assignmentFlagTones: Record<string, BadgeTone> = {
  NO_SERVING_WAREHOUSE: 'danger',
  MANUAL_PRIMARY_INELIGIBLE: 'warning',
  CAMPAIGN_AREA_MISSING: 'warning',
};

export const normCategoryLabels: Record<string, string> = {
  WATER: 'Nước uống',
  FOOD: 'Lương thực',
  BLANKET: 'Chăn màn',
  MEDICINE: 'Y tế',
};

export const normItemTypeLabels: Record<string, string> = {
  NUOC_UONG: 'Nước uống',
  LUONG_THUC: 'Lương thực',
  CHAN_MEN: 'Chăn màn',
  Y_TE: 'Y tế',
};

export const normBasisLabels: Record<string, string> = {
  PER_PERSON_DAY: 'Mỗi người mỗi ngày (nhân số ngày)',
  PER_PERSON: 'Mỗi người, dùng một lần',
};

export const normBasisOptions = [
  { value: 'PER_PERSON_DAY', label: 'Mỗi người mỗi ngày (nhân số ngày)' },
  { value: 'PER_PERSON', label: 'Mỗi người, dùng một lần' },
] as const;

export const normActiveOptions = [
  { value: 'true', label: 'Đang áp dụng' },
  { value: 'false', label: 'Tạm ngưng' },
] as const;

/** Returns the Vietnamese label for a known code, or a neutral fallback for codes this build does not know. */
export function labelFor(map: Record<string, string>, code: unknown, fallback: string): string {
  return typeof code === 'string' && Object.hasOwn(map, code) ? map[code] : fallback;
}
