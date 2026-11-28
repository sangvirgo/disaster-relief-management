export const reconciliationMetrics = [
  ['intake_accepted', 'Đã tiếp nhận'],
  ['posted_movements', 'Tồn theo sổ'],
  ['posted_reserved_movements', 'Giữ theo sổ'],
  ['reserved', 'Đang giữ cho đội'],
  ['delivered', 'Đã giao cho đội'],
] as const;

export function reconciliationResult(flags: unknown): { tone: 'warning' | 'success' | 'muted'; text: string } {
  if (!flags || typeof flags !== 'object') return { tone: 'muted', text: 'Chưa có kết quả kiểm tra' };
  const result = flags as Record<string, unknown>;
  const issues = [result.balance_mismatch === true ? 'Chênh lệch sổ kho' : '', result.commitment_counter_mismatch === true ? 'Chênh lệch xuất và giao hàng' : ''].filter(Boolean);
  if (issues.length) return { tone: 'warning', text: issues.join(' · ') };
  return result.balance_mismatch === false && result.commitment_counter_mismatch === false
    ? { tone: 'success', text: 'Khớp số liệu' } : { tone: 'muted', text: 'Chưa đủ kết quả kiểm tra' };
}
