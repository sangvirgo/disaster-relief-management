import { api, type Service } from './client';

export async function fetchAll<T>(service: Service, path: string): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor = '';
  do {
    if (cursor && seen.has(cursor)) throw new Error('Phân trang trả về mã lặp. Vui lòng thử lại.');
    if (cursor) seen.add(cursor);
    const query = new URLSearchParams({ limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const page = await api<{ items: T[]; next_cursor?: string | null; cursor?: string | null; more?: boolean }>(
      service, `${path}${path.includes('?') ? '&' : '?'}${query}`
    );
    items.push(...page.items);
    cursor = page.next_cursor || (page.more ? page.cursor || '' : '');
    if (page.more && !cursor) throw new Error('Danh sách còn dữ liệu nhưng máy chủ không trả mã trang tiếp theo. Vui lòng thử lại.');
  } while (cursor);
  return items;
}
