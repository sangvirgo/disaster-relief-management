import { jest } from '@jest/globals';
import { DonationReceiptsQueriesService } from '../src/receipts/donation-receipts-queries.service';

const receiptId = '55555555-5555-4555-8555-555555555555';
const deliveryId = '44444444-4444-4444-8444-444444444444';
const itemId = '33333333-3333-4333-8333-333333333333';

function setup(viewerId: string, status = 'PENDING_REVIEW', reviewed = false, currentCounter = 'reviewer-1') {
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('FROM donation_receipt r JOIN donation_delivery')) return [{
      id: receiptId, delivery_id: deliveryId, warehouse_id: '22222222-2222-4222-8222-222222222222',
      version: 2, created_at: new Date('2026-11-23T00:00:00Z'), public_code: 'ABCDEFGH',
      donor_name: 'Người đóng góp', donor_phone: '0901234567', delivery_status: status,
      drive_id: '11111111-1111-4111-8111-111111111111', drive_title: 'Đợt thử', campaign_id: null,
      warehouse_name: 'Kho thử', count_revision: 1, declaration_revision: 1, count_note: 'Ghi chú lượt đầu',
    }];
    if (sql.includes('WITH current_declaration')) return [{
      item_id: itemId, item_name: 'Nước uống', unit_code: 'BOTTLE', unit_name: 'chai', unit_scale: 0,
      declared_quantity: '3', counted_quantity: '2', accepted_quantity: '2', held_quantity: '0',
      rejected_quantity: '0', condition_note: 'Một chai thiếu', expiry_date: null, has_count_line: true,
    }];
    if (sql.includes('FROM receipt_review')) return reviewed ? [{ decision: 'APPROVE', reason: 'Đã duyệt', reviewed_at: new Date('2026-11-23T01:00:00Z') }] : [];
    if (sql.includes('SELECT counted_by_user_id')) return [{ counted_by_user_id: currentCounter, is_count_author: viewerId === 'reviewer-1' || viewerId === currentCounter }];
    return [];
  });
  const sessions = { require: jest.fn(async () => ({ userId: viewerId, grants: [{ role_code: 'REVIEWER', scope_type: 'SYSTEM' }] })) };
  return new DonationReceiptsQueriesService({ query } as never, sessions as never);
}

describe('independent receipt count view', () => {
  it('shows the first counter their exact count and identity flag', async () => {
    const result = await setup('reviewer-1').receipt(receiptId, {} as never);
    expect(result.count).toMatchObject({ is_own_count: true, is_count_author: true, note: 'Ghi chú lượt đầu', lines: [{ counted_quantity: '2' }] });
  });

  it('shows the second reviewer item identities but no first-count figures or notes', async () => {
    const result = await setup('reviewer-2').receipt(receiptId, {} as never);
    expect(result.count).toEqual({
      revision: 1, declaration_revision: 1, is_own_count: false, is_count_author: false,
      lines: [{ item_id: itemId, item_name: 'Nước uống', unit_name: 'chai', unit_scale: 0, has_count_line: true }],
    });
    expect(JSON.stringify(result.count)).not.toContain('Một chai thiếu');
    expect(JSON.stringify(result.count)).not.toContain('counted_quantity');
  });

  it('marks an earlier counter as ineligible after another count revision without revealing that revision', async () => {
    const result = await setup('reviewer-1', 'PENDING_REVIEW', false, 'reviewer-3').receipt(receiptId, {} as never);
    expect(result.count).toMatchObject({ is_own_count: false, is_count_author: true });
    expect(JSON.stringify(result.count)).not.toContain('counted_quantity');
  });

  it('shows the completed result after independent review', async () => {
    const result = await setup('reviewer-2', 'POSTED', true).receipt(receiptId, {} as never);
    expect(result.count).toMatchObject({ is_own_count: false, lines: [{ counted_quantity: '2' }] });
  });
});
