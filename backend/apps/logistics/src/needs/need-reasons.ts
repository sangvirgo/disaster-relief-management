// Stable reason codes for need estimates and need read-model flags. Codes are machine-readable and never change;
// the Vietnamese copy below is the only place where user-facing text for these codes is defined.
export const NEED_REASON_CODES = [
  'NORM_PER_PERSON_DAY',
  'NORM_PER_PERSON',
  'DAYS_DEFAULT',
  'INFANT_MODIFIER_APPLIED',
  'ELDERLY_MODIFIER_APPLIED',
  'ROUNDED_UP_TO_UNIT_SCALE',
  'NORM_NOT_FOUND',
  'QUANTITY_FAR_ABOVE_ESTIMATE',
] as const;

export type NeedReasonCode = (typeof NEED_REASON_CODES)[number];

export const NEED_REASON_COPY: Readonly<Record<NeedReasonCode, string>> = {
  NORM_PER_PERSON_DAY: 'Tính theo định mức mỗi người mỗi ngày, nhân với số ngày.',
  NORM_PER_PERSON: 'Tính theo định mức mỗi người, dùng một lần (không nhân theo số ngày).',
  DAYS_DEFAULT: 'Chưa nhập số ngày, hệ thống dùng mặc định 3 ngày.',
  INFANT_MODIFIER_APPLIED: 'Đã cộng thêm định mức cho trẻ nhỏ.',
  ELDERLY_MODIFIER_APPLIED: 'Đã cộng thêm định mức cho người cao tuổi.',
  ROUNDED_UP_TO_UNIT_SCALE: 'Đã làm tròn lên theo đơn vị tính của vật phẩm.',
  NORM_NOT_FOUND: 'Chưa có định mức đang hoạt động cho nhóm hàng này.',
  QUANTITY_FAR_ABOVE_ESTIMATE: 'Số lượng khai báo lớn hơn 3 lần số ước tính. Hãy kiểm tra lại trước khi xác nhận.',
};

export function needReasonText(code: NeedReasonCode): string {
  return NEED_REASON_COPY[code];
}
