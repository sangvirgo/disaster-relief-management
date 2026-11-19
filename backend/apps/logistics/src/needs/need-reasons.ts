// Stable reason codes for need estimates and need read-model flags. Codes are machine-readable and never change;
// the Vietnamese copy below is the only place where user-facing text for these codes is defined.
export const NEED_REASON_CODES = [
  'NORM_BY_GROUP',
  'NORM_PER_N_PEOPLE',
  'NORM_PER_REQUEST',
  'DEFAULT_ITEM_USED',
  'ROUNDED_UP_TO_UNIT_SCALE',
  'NORM_NOT_FOUND',
  'QUANTITY_ZERO',
  'QUANTITY_FAR_ABOVE_ESTIMATE',
  'DEFAULT_BUNDLE_USED',
  'EXTRACTED_FROM_TEXT',
  'ALIAS_MATCHED',
  'UNMATCHED_TERMS',
] as const;

export type NeedReasonCode = (typeof NEED_REASON_CODES)[number];

export const NEED_REASON_COPY: Readonly<Record<NeedReasonCode, string>> = {
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

export function needReasonText(code: NeedReasonCode): string {
  return NEED_REASON_COPY[code];
}
