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
  NORM_BY_GROUP: 'Tính theo nhóm người: người lớn, trẻ em và người cao tuổi, mỗi nhóm có định mức riêng.',
  NORM_PER_N_PEOPLE: 'Tính theo số người: cứ mỗi nhóm người theo định mức thì cần một đơn vị.',
  NORM_PER_REQUEST: 'Tính theo mỗi yêu cầu: số lượng cố định cho một yêu cầu cứu trợ.',
  DEFAULT_ITEM_USED: 'Chưa chọn vật phẩm, hệ thống dùng vật phẩm mặc định của nhóm hàng.',
  ROUNDED_UP_TO_UNIT_SCALE: 'Đã làm tròn lên theo đơn vị tính của vật phẩm.',
  NORM_NOT_FOUND: 'Chưa có định mức đang hoạt động cho nhóm hàng này.',
  QUANTITY_ZERO: 'Định mức của nhóm hàng này bằng 0 cho lần yêu cầu này, nên không tạo dòng nhu cầu.',
  QUANTITY_FAR_ABOVE_ESTIMATE: 'Số lượng khai báo lớn hơn 3 lần số ước tính. Hãy kiểm tra lại trước khi xác nhận.',
  DEFAULT_BUNDLE_USED: 'Người dân không nêu rõ hàng cần, hệ thống dùng danh sách mặc định theo định mức. Cần kiểm tra lại.',
  EXTRACTED_FROM_TEXT: 'Vật phẩm được đối chiếu từ mô tả của người dân bằng AI. Đây chỉ là gợi ý để con người xem xét.',
  ALIAS_MATCHED: 'Vật phẩm được khớp theo tên gọi thường dùng trong mô tả của người dân (không dùng AI).',
  UNMATCHED_TERMS: 'Có cụm từ người dân nêu nhưng không khớp vật phẩm nào trong danh mục. Cần xem xét thủ công.',
};

/** Where the proposed items came from. Codes are the backend extraction sources; GEMINI is only a suggestion. */
export const extractionSourceLabels: Record<string, string> = {
  GEMINI: 'AI gợi ý',
  ALIAS: 'Khớp từ khóa',
  DEFAULT_BUNDLE: 'Gói mặc định',
};

export const extractionSourceTones: Record<string, BadgeTone> = {
  GEMINI: 'info',
  ALIAS: 'success',
  DEFAULT_BUNDLE: 'warning',
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
  FOOD: 'Thực phẩm',
  BLANKET: 'Chăn',
  MEDICINE: 'Thuốc hoặc vật tư y tế',
};

export const normItemTypeLabels: Record<string, string> = {
  NUOC_UONG: 'Nước uống',
  LUONG_THUC: 'Lương thực',
  CHAN_MEN: 'Chăn màn',
  Y_TE: 'Y tế',
};

export const normBasisLabels: Record<string, string> = {
  BY_GROUP: 'Theo nhóm người',
  PER_N_PEOPLE: 'Theo số người',
  PER_REQUEST: 'Theo mỗi yêu cầu',
};

export const normBasisOptions = [
  { value: 'BY_GROUP', label: 'Theo nhóm người' },
  { value: 'PER_N_PEOPLE', label: 'Theo số người' },
  { value: 'PER_REQUEST', label: 'Theo mỗi yêu cầu' },
] as const;

export const normFieldLabels: Record<string, string> = {
  qty_adult: 'Người lớn',
  qty_child: 'Trẻ em',
  qty_elderly: 'Người cao tuổi',
  people_per_unit: 'Số người mỗi đơn vị',
  fixed_quantity: 'Số lượng cố định',
};

export const normActiveOptions = [
  { value: 'true', label: 'Đang áp dụng' },
  { value: 'false', label: 'Tạm ngưng' },
] as const;

/** Returns the Vietnamese label for a known code, or a neutral fallback for codes this build does not know. */
export function labelFor(map: Record<string, string>, code: unknown, fallback: string): string {
  return typeof code === 'string' && Object.hasOwn(map, code) ? map[code] : fallback;
}
