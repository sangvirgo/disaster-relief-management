import { jest } from '@jest/globals';
import { AssetsQueriesService } from '../src/assets/assets-queries.service';

describe('Logistics asset lists', () => {
  it('applies the live scope in SQL and omits private notes from list rows', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([{
      id: '33333333-3333-4333-8333-333333333333',
      organization_id: '22222222-2222-4222-8222-222222222222',
      region_code: 'R01',
      name: 'Điểm cứu trợ',
      contact_note: 'Số điện thoại cá nhân',
      operating_note: 'Ghi chú riêng',
      longitude: 106.7,
      latitude: 10.8,
      status: 'ACTIVE',
      version: 1,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    }]) };
    const sessions = { require: jest.fn().mockResolvedValue({
      userId: '11111111-1111-4111-8111-111111111111',
      grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'REGION', organization_id: '22222222-2222-4222-8222-222222222222', region_code: 'R01' }],
    }) };
    const service = new AssetsQueriesService(dataSource as never, sessions as never);

    const result = await service.list('relief_point', {}, { method: 'GET', headers: {} } as never) as {
      items: Array<Record<string, unknown>>;
    };
    expect(result.items[0]).not.toHaveProperty('contact_note');
    expect(result.items[0]).not.toHaveProperty('operating_note');
    expect(dataSource.query.mock.calls[0]?.[0]).toContain('a.organization_id=$1 AND a.region_code=$2');
  });
});
