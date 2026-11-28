const reasons: Record<string, string> = {
  ACTIVE_MISSION: 'Vẫn có nhiệm vụ chưa kết thúc. Mở phần nhiệm vụ để kiểm tra đội đang xử lý.',
  FAILED_MISSION_REVIEW_REQUIRED: 'Có nhiệm vụ thất bại chưa được điều phối viên rà soát.',
  NO_COMPLETED_MISSION_EVIDENCE: 'Chưa có nhiệm vụ hoàn thành kèm ghi nhận kết quả cứu hộ.',
  OPEN_NEED: 'Vẫn còn nhu cầu vật tư chưa được hoàn tất hoặc hủy.',
  UNSETTLED_ISSUE: 'Vẫn còn vật tư chưa được đối soát bàn giao.',
  RESERVED_QUANTITY: 'Vẫn còn hàng đang giữ chỗ. Kiểm tra yêu cầu nhận hàng chưa bàn giao.',
  NO_DELIVERED_AID: 'Chưa ghi nhận hàng đã bàn giao để dùng căn cứ chỉ hỗ trợ vật tư.',
  DELIVERED_AID_PRESENT: 'Đã có hàng bàn giao; cần chọn căn cứ kết thúc phù hợp với kết quả này.',
};

/** Only known machine codes become UI copy; never echo arbitrary error details. */
export function resolutionErrorCopy(code: string, details: unknown): string | undefined {
  if (!['RESOLUTION_BLOCKED', 'CYCLE_NOT_SETTLED'].includes(code) || !details || typeof details !== 'object') return undefined;
  const codes = (details as Record<string, unknown>).reasons;
  if (!Array.isArray(codes)) return undefined;
  const messages = [...new Set(codes.filter((value): value is string => typeof value === 'string' && Object.hasOwn(reasons, value)))].map(value => reasons[value]);
  return messages.length ? `Chưa thể kết thúc SOS. ${messages.join(' ')}` : undefined;
}
