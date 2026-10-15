import { jest } from '@jest/globals';
import { DriveQueriesService } from '../src/drives/drives-queries.service';

const driveId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';

describe('Logistics donation drive queries', () => {
  it('lists open drives by the indexed creation cursor and returns posted accepted totals', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('FROM donation_drive d')) return [{
        id: driveId, organization_id: '11111111-1111-4111-8111-111111111111', intake_warehouse_id: '44444444-4444-4444-8444-444444444444',
        campaign_id: null, campaign_status: 'ACTIVE', campaign_status_at: '2026-10-12T11:00:00.000Z', status: 'OPEN', title: 'Nước uống', description: null,
        opens_at: null, closes_at: null, version: 2, created_at: '2026-10-12T12:00:00.000Z', cursor_created_at: '2026-10-12T12:00:00.000000Z',
        warehouse_name: 'Kho trung tâm', address_note: 'Cổng phía đông', location_public: false, longitude: 106.7, latitude: 10.8,
      }];
      return [{ drive_id: driveId, item_id: itemId, item_name: 'Nước đóng chai', item_type_name: 'Đồ uống', unit_code: 'BOTTLE',
        unit_name: 'Chai', scale: 0, target_quantity: '20', acceptance_note: null, accepted_total: '7' }];
    });
    const service = new DriveQueriesService({ query } as never, { require: jest.fn() } as never);

    const result = await service.publicList({ limit: 20 });

    expect(query.mock.calls[0]?.[0]).toContain("d.status='OPEN'");
    expect(query.mock.calls[0]?.[0]).toContain('d.campaign_status_at');
    expect(query.mock.calls[0]?.[0]).toContain('ORDER BY d.created_at DESC,d.id DESC');
    expect(result.items[0]).toMatchObject({
      id: driveId,
      campaign_status_at: '2026-10-12T11:00:00.000Z',
      intake_location: { warehouse_name: 'Kho trung tâm', address_note: 'Cổng phía đông', location: null },
      items: [{ item_id: itemId, accepted_total: '7', target_quantity: '20' }],
    });
    expect(query.mock.calls[1]?.[0]).toContain("sm.movement_type IN ('RECEIPT','RECEIPT_HELD_RELEASE')");
  });

  it('includes exact warehouse coordinates only when the manager made the location public', async () => {
    const query = jest.fn(async (sql: string) => sql.includes('FROM donation_drive d') ? [{
      id: driveId, organization_id: '11111111-1111-4111-8111-111111111111', intake_warehouse_id: '44444444-4444-4444-8444-444444444444',
      campaign_id: null, campaign_status: null, campaign_status_at: null, status: 'OPEN', title: 'Nước uống', description: null,
      opens_at: null, closes_at: null, version: 2, created_at: new Date('2026-10-12T12:00:00.000Z'), cursor_created_at: '2026-10-12T12:00:00.000000Z',
      warehouse_name: 'Kho trung tâm', address_note: null, location_public: true, longitude: 106.7, latitude: 10.8,
    }] : []);
    const service = new DriveQueriesService({ query } as never, { require: jest.fn() } as never);

    const result = await service.publicDetail(driveId);

    expect(result).toMatchObject({ intake_location: { location: { type: 'Point', coordinates: [106.7, 10.8] } } });
  });
});
