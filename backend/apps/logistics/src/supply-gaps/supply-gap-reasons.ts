import type { GapReasonCode } from './supply-gap.calculator';

// Stable reason codes stored on supply_gap.reason_codes. Clients branch on the code; the Vietnamese copy lives only here.
export const SUPPLY_GAP_REASON_COPY: Record<GapReasonCode, string> = {
  DEMAND_EXCEEDS_SUPPLY: 'Nhu cầu chưa được đáp ứng vượt quá tồn kho khả dụng và số lượng quyên góp còn lại tại kho này.',
  NO_STOCK_AT_WAREHOUSE: 'Kho này hiện không còn tồn kho khả dụng cho mặt hàng này.',
  NEAR_CAPACITY: 'Nhu cầu đã đạt từ 80% tồn kho và số lượng quyên góp còn lại. Cần theo dõi thêm.',
  CAMPAIGN_CONTENTION: 'Nhiều chiến dịch cùng dùng kho này và cùng cần mặt hàng này.',
  BACKUP_STOCK_AVAILABLE: 'Kho dự phòng của chiến dịch có đủ tồn kho để hỗ trợ. Người quản lý có thể cân nhắc điều phối.',
  DRIVE_PLEDGE_APPLIED: 'Đã trừ số lượng còn lại của đợt quyên góp đang mở hoặc đã được chấp nhận.',
};

export interface SupplyGapReasonView {
  code: GapReasonCode;
  message: string;
}

export function supplyGapReasonViews(codes: readonly string[]): SupplyGapReasonView[] {
  return codes
    .filter((code): code is GapReasonCode => Object.hasOwn(SUPPLY_GAP_REASON_COPY, code))
    .map((code) => ({ code, message: SUPPLY_GAP_REASON_COPY[code] }));
}
