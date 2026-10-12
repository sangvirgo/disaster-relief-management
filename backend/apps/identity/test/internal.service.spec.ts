import { describe, expect, it, jest } from '@jest/globals';
import { InternalService } from '../src/internal/internal.service';

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
