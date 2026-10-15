import { describe, expect, it, jest } from '@jest/globals';
import { InternalService } from '../src/internal/internal.service';

describe('Identity internal active user check service', () => {
  const userId = '00000000-0000-4000-8000-000000000001';

  it.each([
    [[], { active: false, reason: 'USER_NOT_FOUND' }],
    [[{ status: 'DISABLED' }], { active: false, reason: 'USER_INACTIVE' }],
    [[{ status: 'ACTIVE' }], { active: true }],
  ] as const)('checks only account existence and status', async (rows, expected) => {
    const query = jest.fn(async () => rows);
    const service = Object.assign(Object.create(InternalService.prototype), {
      introspectionDataSource: { query },
    }) as InternalService;
    const check = (service as unknown as Record<string, unknown>)['activeUserCheck'] as ((id: string) => Promise<unknown>) | undefined;

    expect(typeof check).toBe('function');
    await expect(check?.call(service, userId)).resolves.toEqual(expected);
    expect(query).toHaveBeenCalledWith('SELECT status FROM app_user WHERE id = $1', [userId]);
  });
});

describe('Identity internal region lookup service', () => {
  it('returns only matching names from Identity region rows', async () => {
    const query = jest.fn(async (_sql: string, _parameters: unknown[]) => [
      { code: 'VN01', name: 'Khu vực Một' },
    ]);
    const service = Object.assign(Object.create(InternalService.prototype), {
      introspectionDataSource: { query },
    }) as InternalService;

    await expect(service.lookupRegions(['VN01', 'UNKNOWN'])).resolves.toEqual({
      items: [{ code: 'VN01', name: 'Khu vực Một' }],
    });
    expect(query).toHaveBeenCalledWith(
      'SELECT code, name FROM region WHERE code = ANY($1::text[]) ORDER BY code',
      [['VN01', 'UNKNOWN']],
    );
  });
});
