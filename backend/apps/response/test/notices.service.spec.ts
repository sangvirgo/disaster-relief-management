import { jest } from '@jest/globals';
import { decodeKeysetCursor, encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { AppError } from '@c48/technical/errors/errors';
import { NoticesService } from '../src/notices/notices.service';

const noticeId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const exactTime = '2026-10-11T12:34:56.123456Z';

function makeService(queryResults: unknown[][]) {
  const dataSource = { query: jest.fn(async () => queryResults.shift() ?? []) };
  const sessions = { require: jest.fn(async () => ({ userId, grants: [] })) };
  return {
    service: new NoticesService(dataSource as never, sessions as never),
    dataSource,
    sessions,
  };
}

describe('NoticesService', () => {
  it('lists only the authenticated recipient notices with a stable keyset cursor', async () => {
    const { service, dataSource } = makeService([[
      { id: noticeId, notice_type: 'REQUEST_OVERDUE', payload: { text_code: 'REQUEST_OVERDUE', request_id: noticeId }, created_at: '2026-10-11T12:34:56.123Z', read_at: null, cursor_created_at: exactTime },
      { id: '00000000-0000-4000-8000-000000000003', notice_type: 'MISSION_OFFER_OVERDUE', payload: { text_code: 'MISSION_OFFER_OVERDUE' }, created_at: '2026-10-11T12:34:56.123Z', read_at: null, cursor_created_at: exactTime },
    ]]);

    const page = await service.list({ limit: 1 }, {} as never);

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ id: noticeId, notice_type: 'REQUEST_OVERDUE', read_at: null });
    expect(page.more).toBe(true);
    expect(decodeKeysetCursor(page.cursor!, { recipient_user_id: userId }).sort).toEqual([exactTime]);
    expect(dataSource.query.mock.calls[0]?.[0]).toContain('recipient_user_id=$1');
    expect(dataSource.query.mock.calls[0]?.[0]).toContain('ORDER BY created_at DESC,id DESC');
    expect(dataSource.query.mock.calls[0]?.[1]).toEqual([userId, null, null, 2]);
  });

  it('filters unread notices without accepting another recipient cursor', async () => {
    const filters = { recipient_user_id: userId, unread: 'false' };
    const foreignFilterCursor = encodeKeysetCursor([exactTime], noticeId, filters);
    const { service, dataSource } = makeService([[]]);

    await expect(service.list({ unread: 'true', cursor: foreignFilterCursor }, {} as never))
      .rejects.toMatchObject({ code: 'CURSOR_INVALID' });

    await service.list({ unread: 'true' }, {} as never);
    expect(dataSource.query.mock.calls[0]?.[0]).toContain('recipient_user_id=$1 AND read_at IS NULL');
  });

  it('filters notices that have already been read', async () => {
    const { service, dataSource } = makeService([[]]);

    await service.list({ unread: 'false' }, {} as never);

    expect(dataSource.query.mock.calls[0]?.[0]).toContain('recipient_user_id=$1 AND read_at IS NOT NULL');
  });

  it('rejects malformed cursor sort values before querying the database', async () => {
    const filters = { recipient_user_id: userId };
    const invalidCursors = [
      encodeKeysetCursor([123], noticeId, filters),
      encodeKeysetCursor([exactTime], 'not-a-uuid', filters),
      encodeKeysetCursor([exactTime, exactTime], noticeId, filters),
      encodeKeysetCursor(['2026-02-31T12:34:56.123456Z'], noticeId, filters),
    ];
    const { service, dataSource } = makeService([[]]);

    for (const cursor of invalidCursors) {
      await expect(service.list({ cursor }, {} as never)).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
    }
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('sets the first read time once and returns the owned notice read state', async () => {
    const readAt = '2026-10-11T12:35:00.000Z';
    const { service, dataSource } = makeService([[[{ id: noticeId, read_at: readAt }], 1]]);

    await expect(service.markRead(noticeId, {} as never)).resolves.toEqual({ id: noticeId, read_at: readAt });
    expect(dataSource.query.mock.calls[0]?.[0]).toContain('COALESCE(read_at,clock_timestamp())');
    expect(dataSource.query.mock.calls[0]?.[0]).toContain('id=$1 AND recipient_user_id=$2');
    expect(dataSource.query.mock.calls[0]?.[1]).toEqual([noticeId, userId]);
  });

  it('hides notices owned by other recipients', async () => {
    const { service } = makeService([[[], 0]]);

    await expect(service.markRead(noticeId, {} as never)).rejects.toBeInstanceOf(AppError);
  });
});
