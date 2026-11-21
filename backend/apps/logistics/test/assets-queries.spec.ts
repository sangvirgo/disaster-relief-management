import { jest } from '@jest/globals';
import { AssetsQueriesService } from '../src/assets/assets-queries.service';

describe('Logistics asset lists', () => {
  it('applies SYSTEM scope in SQL and omits the private address note from list rows', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([{
      id: '33333333-3333-4333-8333-333333333333',

      name: 'Kho trung tâm',
      address_note: 'Ghi chú riêng',
      location_public: false,
      service_radius_m: 5000,
      longitude: 106.7,
      latitude: 10.8,
      status: 'ACTIVE',
      version: 1,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    }]) };
    const sessions = { require: jest.fn().mockResolvedValue({
      userId: '11111111-1111-4111-8111-111111111111',
      grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM',}],
    }) };
    const service = new AssetsQueriesService(dataSource as never, sessions as never);

    const result = await service.list('warehouse', {}, { method: 'GET', headers: {} } as never) as {
      items: Array<Record<string, unknown>>;
    };
    expect(result.items[0]).not.toHaveProperty('address_note');
    expect(dataSource.query.mock.calls[0]?.[0]).toContain('WHERE TRUE');
    expect(dataSource.query.mock.calls[0]?.[1]).toEqual([51]);
  });

  it('returns the private address note in the warehouse detail for asset managers only', async () => {
    const row = { id: '33333333-3333-4333-8333-333333333333', name: 'Kho A', address_note: 'Cổng sau', location_public: false,
      service_radius_m: 5000, longitude: 106.7, latitude: 10.8, status: 'ACTIVE', version: 3, created_at: new Date('2026-01-01T00:00:00.000Z') };
    const dataSource = { query: jest.fn().mockResolvedValue([row]) };
    const manager = { require: jest.fn().mockResolvedValue({ userId: 'u1', grants: [{ role_code: 'OPERATIONS_MANAGER', scope_type: 'SYSTEM' }] }) };
    const service = new AssetsQueriesService(dataSource as never, manager as never);

    await expect(service.warehouseDetail(row.id, {} as never)).resolves.toMatchObject({ id: row.id, address_note: 'Cổng sau', version: 3, service_radius_m: 5000 });

    const outsider = new AssetsQueriesService(dataSource as never, { require: jest.fn().mockResolvedValue({ userId: 'u2', grants: [] }) } as never);
    await expect(outsider.warehouseDetail(row.id, {} as never)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
