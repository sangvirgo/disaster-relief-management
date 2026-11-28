export type RescueProgress = { active: number; completed: number };
export function rescueProgressMessage(status: string, progress?: RescueProgress): string | null {
  if (!progress || ['CLOSED', 'RESOLVED', 'REJECTED', 'DUPLICATE', 'CANCELLED'].includes(status)) return null;
  if (progress.active > 0) return 'Đội cứu hộ đang xử lý nhiệm vụ';
  if (progress.completed > 0) return 'Đội đã báo hoàn thành · Chờ xác nhận kết quả SOS';
  return null;
}
