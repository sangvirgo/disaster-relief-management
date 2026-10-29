import { jest } from '@jest/globals';
import { encodeKeysetCursor } from '@c48/technical/pagination/keyset';
import { RequestOperationsQueriesService } from '../src/operations/request-operations.queries.service';
import { filtersHash } from '../src/operations/request-operations.helpers';

const requestId = '00000000-0000-4000-8000-000000000001';
const userId = '00000000-0000-4000-8000-000000000002';
const grants = [{
  role_code: 'COORDINATOR', scope_type: 'ORGANIZATION',
  organization_id: '00000000-0000-4000-8000-000000000003',
  region_code: null, campaign_id: null,
}] as const;

function makeService() {
  const dataSource = { query: jest.fn(async () => []) };
  const sessions = { require: jest.fn(async () => ({ userId, grants })) };
  const service = new RequestOperationsQueriesService(
    dataSource as never, sessions as never, { overdueMinutes: 15 }, {} as never,
  );
  return { service, dataSource };
}

describe('coordinator queue order', () => {
  it('uses descending keyset pagination so the latest requests appear first', async () => {
    const { service, dataSource } = makeService();
    const filters = {};
    const cursor = encodeKeysetCursor(
      ['2026-10-28T12:34:56.123456Z'], requestId,
      filtersHash(grants, userId, filters, 'requests'),
    );

    await service.queue({ ...filters, cursor }, {} as never);

    const [sql, values] = dataSource.query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toContain('ORDER BY r.received_at DESC,r.id DESC');
    expect(sql).toMatch(/\(r\.received_at,r\.id\)<\(\$\d+::timestamptz,\$\d+::uuid\)/);
    expect(values).toContain('2026-10-28T12:34:56.123456Z');
    expect(values).toContain(requestId);
  });
});
