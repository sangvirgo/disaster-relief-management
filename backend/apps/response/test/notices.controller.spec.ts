import { jest } from '@jest/globals';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NoticesController } from '../src/notices/notices.controller';
import { NoticePageQueryDto } from '../src/notices/notices.dto';

describe('NoticesController', () => {
  it('sets no-store on notice list and read responses', async () => {
    const notices = {
      list: jest.fn(async () => ({ items: [], more: false })),
      markRead: jest.fn(async () => ({ id: 'notice-1', read_at: '2026-10-11T12:35:00.000Z' })),
    };
    const controller = new NoticesController(notices as never);
    const response = { setHeader: jest.fn() };

    await controller.list({}, {} as never, response as never);
    await controller.markRead('notice-1', {} as never, response as never);

    expect(response.setHeader).toHaveBeenNthCalledWith(1, 'Cache-Control', 'no-store');
    expect(response.setHeader).toHaveBeenNthCalledWith(2, 'Cache-Control', 'no-store');
  });

  it('validates unread filters and converts the page limit from a query string', async () => {
    const valid = plainToInstance(NoticePageQueryDto, { unread: 'false', limit: '100' });
    const invalid = plainToInstance(NoticePageQueryDto, { unread: 'yes', limit: '101' });

    await expect(validate(valid, { whitelist: true, forbidNonWhitelisted: true })).resolves.toHaveLength(0);
    await expect(validate(invalid, { whitelist: true, forbidNonWhitelisted: true })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'unread' }),
        expect.objectContaining({ property: 'limit' }),
      ]),
    );
  });
});
