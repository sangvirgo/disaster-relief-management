import type { PickupActionKey } from './pickupRules';

/*
 * Vietnamese copy for pickup-ticket statuses, close-out reasons and API error codes.
 * Clients branch on codes only; unknown codes fall back to the API's own Vietnamese message.
 */

export type PickupStatus = 'OPEN' | 'READY' | 'HANDED_OVER' | 'CLOSED' | 'CANCELLED';
export type CloseoutStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export const pickupStatusLabels: Record<PickupStatus, string> = {
  OPEN: 'Mới tạo',
  READY: 'Sẵn sàng',
  HANDED_OVER: 'Đã bàn giao',
  CLOSED: 'Đã đóng',
  CANCELLED: 'Đã hủy',
};

export const pickupStatusTone: Record<PickupStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  OPEN: 'info',
  READY: 'info',
  HANDED_OVER: 'warning',
  CLOSED: 'success',
  CANCELLED: 'neutral',
};

export const closeoutStatusLabels: Record<CloseoutStatus, string> = {
  DRAFT: 'Bản nháp',
  SUBMITTED: 'Đã gửi duyệt',
  APPROVED: 'Đã duyệt',
  REJECTED: 'Bị từ chối',
};

export const retireReasonLabels: Record<'CONSUMED' | 'EXPIRED' | 'DAMAGED' | 'LOST' | 'NOT_RETURNABLE', string> = {
  CONSUMED: 'Đã dùng hết',
  EXPIRED: 'Hết hạn',
  DAMAGED: 'Hư hỏng',
  LOST: 'Thất lạc',
  NOT_RETURNABLE: 'Không thể trả lại',
};

export const pickupErrorCopy: Record<string, string> = {
  PICKUP_MISSION_NOT_FOUND: 'Không tìm thấy nhiệm vụ này. Hãy tải lại danh sách nhiệm vụ.',
  PICKUP_MISSION_NOT_ASSIGNABLE: 'Nhiệm vụ chưa được đội nhận hoặc đã kết thúc nên chưa thể lập phiếu lấy hàng.',
  PICKUP_TICKET_EXISTS: 'Nhiệm vụ này đã có phiếu lấy hàng. Hãy tải lại để xem phiếu.',
  PICKUP_NO_PRIMARY_WAREHOUSE: 'Chiến dịch chưa có kho chính. Cần phân công kho trước khi lập phiếu lấy hàng.',
  PICKUP_NO_NEEDS: 'SOS chưa có nhu cầu hàng hóa đã xác nhận nên chưa thể lập phiếu lấy hàng.',
  PICKUP_NOTHING_RESERVABLE: 'Không có mặt hàng nào đủ tồn kho tại kho đã chọn để giữ chỗ. Xem kho dự phòng bên dưới.',
  PICKUP_NOT_CONFIRMED: 'Phiếu cần được xác nhận trước khi bàn giao hàng.',
  PICKUP_COLLECTOR_NOT_MEMBER: 'Người nhận hàng không còn là thành viên đang hoạt động của đội. Hãy chọn người khác trong danh sách đội.',
  PICKUP_ITEM_NOT_ON_TICKET: 'Mặt hàng này không nằm trong phiếu lấy hàng.',
  PICKUP_DELIVERY_EXCEEDS_CUSTODY: 'Số lượng giao vượt quá số đội đang giữ cho mặt hàng này. Hãy tải lại số liệu.',
  PICKUP_LEDGER_MISMATCH: 'Số liệu bàn giao không khớp với sổ kho. Cần đối soát trước khi tiếp tục.',
  PICKUP_UNACCOUNTED_GOODS: 'Chưa thể kết thúc SOS vì phiếu lấy hàng vẫn còn hàng chưa đối soát.',
  CLOSEOUT_LINES_INVALID: 'Phiếu đối soát cần đúng một dòng cho mỗi mặt hàng của phiếu lấy hàng. Hãy tải lại phiếu.',
  CLOSEOUT_INVARIANT_VIOLATED: 'Số đã giao, trả lại và hủy phải bằng đúng số đã giữ của từng mặt hàng.',
  CLOSEOUT_RETIRE_REASON_REQUIRED: 'Cần chọn lý do cho số lượng hủy.',
  ITEM_NOT_RETURNABLE: 'Mặt hàng này không được nhập lại kho. Hãy ghi nhận là hủy kèm lý do.',
  CLOSEOUT_STALE: 'Số liệu đã thay đổi sau khi gửi duyệt. Hãy tải lại và lập lại phiếu đối soát.',
  SELF_REVIEW_FORBIDDEN: 'Bạn không thể duyệt phiếu đối soát do chính mình gửi.',
  SELF_HANDOFF_FORBIDDEN: 'Bạn đã bàn giao hàng của phiếu này nên không thể duyệt đối soát. Hãy nhờ người duyệt khác.',
  SELF_APPROVAL_FORBIDDEN: 'Bạn không thể tự xác nhận hoặc bàn giao phiếu do chính mình chuẩn bị hoặc xác nhận.',
  STATE_TRANSITION_INVALID: 'Phiếu đang ở trạng thái không cho phép thao tác này. Hãy tải lại để xem trạng thái mới.',
  VERSION_CONFLICT: 'Phiếu đã được cập nhật bởi người khác. Hệ thống đã tải lại dữ liệu mới; hãy kiểm tra và thực hiện lại.',
  APPROVAL_STALE: 'Bản kiểm đếm đã thay đổi sau khi duyệt. Hãy tải lại và thực hiện lại.',
  ALREADY_DISPATCHED: 'Phiếu đã xuất kho. Hãy tải lại để xem trạng thái mới.',
  INSUFFICIENT_STOCK: 'Kho không đủ hàng cho số lượng này.',
  HANDOFF_EXCEEDS_BALANCE: 'Số lượng bàn giao vượt quá số đang có ở giai đoạn này.',
  FORBIDDEN: 'Tài khoản của bạn không có quyền thực hiện bước này.',
  NOT_FOUND: 'Không tìm thấy phiếu lấy hàng hoặc bạn không có quyền xem.',
  NETWORK_UNAVAILABLE: 'Không thể kết nối tới máy chủ. Yêu cầu chưa được xác nhận; hãy thử lại với cùng thao tác.',
};

/** 403 explanations that depend on which action the user attempted. */
export const pickupForbiddenCopy: Partial<Record<PickupActionKey | 'load', string>> = {
  load: 'Bạn không có quyền xem phiếu lấy hàng của nhiệm vụ này.',
  create: 'Chỉ điều phối viên hoặc quản lý vận hành được lập phiếu lấy hàng.',
  cancel: 'Chỉ điều phối viên hoặc quản lý vận hành được hủy phiếu lấy hàng.',
  reserve: 'Chỉ quản lý vận hành được giữ hàng cho phiếu. Điều phối viên có thể lập và hủy phiếu.',
  confirm: 'Chỉ quản lý vận hành được xác nhận phiếu. Người duyệt không xác nhận được phiếu lấy hàng.',
  handover: 'Chỉ quản lý vận hành có quyền xuất kho được ghi nhận bàn giao hàng cho đội.',
  delivery: 'Chỉ quản lý vận hành được ghi nhận giao hàng cho hộ dân.',
  closeoutView: 'Bạn không có quyền xem phiếu đối soát. Hãy liên hệ quản lý vận hành.',
  closeoutSave: 'Chỉ điều phối viên hoặc quản lý vận hành được lưu phiếu đối soát.',
  closeoutSubmit: 'Chỉ điều phối viên hoặc quản lý vận hành được gửi duyệt phiếu đối soát.',
  closeoutReview: 'Bạn không có quyền duyệt phiếu đối soát này. Chỉ quản lý vận hành hoặc người duyệt được phân quyền mới duyệt được.',
};

interface ErrorLike {
  code?: unknown;
  message?: unknown;
  status?: unknown;
}

function asErrorLike(error: unknown): ErrorLike | null {
  return error && typeof error === 'object' ? (error as ErrorLike) : null;
}

export function pickupErrorCode(error: unknown): string | null {
  const like = asErrorLike(error);
  return typeof like?.code === 'string' ? like.code : null;
}

/** Vietnamese message for a failed pickup request. Context copy wins for 403; known codes next; then the API message. */
export function pickupErrorMessage(error: unknown, action?: PickupActionKey | 'load'): string {
  const code = pickupErrorCode(error);
  const like = asErrorLike(error);
  if (code === 'FORBIDDEN' && action && pickupForbiddenCopy[action]) return pickupForbiddenCopy[action];
  if (code && pickupErrorCopy[code]) return pickupErrorCopy[code];
  if (typeof like?.message === 'string' && like.message.trim()) return like.message;
  return 'Chưa thể hoàn tất thao tác. Vui lòng thử lại.';
}

/** Short, non-identifying label for a user id: "Bạn" for the current user, otherwise a masked id. */
export function actorLabel(userId: string | null | undefined, currentUserId: string): string {
  if (!userId) return 'Chưa có thông tin';
  if (userId === currentUserId) return 'Bạn';
  return `Người dùng …${userId.slice(-6)}`;
}
