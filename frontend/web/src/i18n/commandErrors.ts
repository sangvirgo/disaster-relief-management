// Vietnamese copy for logistics command error codes (need estimates, confirmations, norms). Codes are the API contract;
// clients branch on codes and show this copy. Shared by the generic API client and the proposal queue.
export const logisticsCommandErrorCopy: Record<string, string> = {
  NEED_NOT_ESTIMATED: 'Dòng này không còn là đề xuất ước tính nên không thể xác nhận theo cách này.',
  NEED_ITEM_TYPE_MISMATCH: 'Chỉ có thể đổi sang vật phẩm cùng nhóm hàng.',
  NEED_EXISTS: 'Chu kỳ này đã có nhu cầu cho vật phẩm đã chọn.',
  BELOW_PROTECTED_QUANTITY: 'Số lượng không được thấp hơn phần hàng đã được giữ cho dòng này.',
  NEED_NORM_SHAPE_INVALID: 'Các trường định mức không khớp với cách tính đã chọn.',
  NEED_DEFAULT_ITEM_INVALID: 'Vật phẩm mặc định phải đang hoạt động và cùng nhóm hàng với định mức.',
};
