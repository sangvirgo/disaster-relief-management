import { api, ApiError } from './client';

/** Staff drive data is exposed by the scoped catalog, including closed and draft drives. */
export async function loadStaffDrive<T extends { id?: string }>(id: string): Promise<T> {
  let cursor = '';
  const seen = new Set<string>();
  do {
    const params = new URLSearchParams({ limit: '100' });
    if (cursor) params.set('cursor', cursor);
    const page = await api<{ items: T[]; more: boolean; cursor?: string }>('logistics', `/donation-drives?${params}`);
    const drive = page.items.find(item => item.id === id);
    if (drive) return drive;
    if (!page.more) break;
    if (!page.cursor || seen.has(page.cursor)) throw new Error('Không thể đọc trang tiếp theo của danh mục đợt quyên góp. Vui lòng thử lại.');
    seen.add(page.cursor);
    cursor = page.cursor;
  } while (cursor);
  throw new ApiError('NOT_FOUND', 404, 'Không tìm thấy đợt quyên góp trong phạm vi bạn được phép xem.');
}
