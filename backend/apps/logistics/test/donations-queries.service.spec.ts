import { jest } from '@jest/globals';
import { hashPurposeBoundSecret } from '../../../packages/technical/src/security/secret-hash';
import { DonationsQueriesService } from '../src/drives/donations-queries.service';

const deliveryId = '44444444-4444-4444-8444-444444444444';
const itemId = '33333333-3333-4333-8333-333333333333';
const secret = Buffer.alloc(32, 7).toString('base64url');
const config = { peppers: { v1: 'test-donation-secret-pepper-that-is-long-enough' }, currentPepperVersion: 'v1' };

function request() {
  return { method: 'GET', headers: {} } as never;
}

describe('Logistics donor tracking queries', () => {
  it('returns private tracking data only after capability verification and never exposes donor contacts', async () => {
    const dataSource = { query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM donation_delivery')) return [{
        id: deliveryId, drive_id: '22222222-2222-4222-8222-222222222222', public_code: 'ABCDEFGH',
        donor_name: 'Người quyên góp', donor_phone: '0901234567', donor_user_id: null,
        capability_hash: hashPurposeBoundSecret(secret, 'donation-delivery', config.peppers, 'v1'), status: 'DECLARED', version: 1,
      }];
      if (sql.includes('FROM donation_declaration')) return [{ revision: 1, created_by_kind: 'DONOR' }];
      if (sql.includes('FROM donation_line')) return [{ item_id: itemId, item_name: 'Nước uống', unit_name: 'chai', declared_quantity: '3' }];
      return [];
    }) };
    const service = new DonationsQueriesService(dataSource as never, { require: jest.fn() } as never, config);

    const result = await service.track(deliveryId, secret, request());

    expect(result).toMatchObject({
      id: deliveryId,
      public_code: 'ABCDEFGH',
      status: 'DECLARED',
      declaration: { revision: 1, lines: [{ item_id: itemId, declared_quantity: '3' }] },
      disputes: [],
    });
    expect(result).not.toHaveProperty('donor_name');
    expect(result).not.toHaveProperty('donor_phone');
  });

  it('returns only the documented public receipt fields from the selected count revision', async () => {
    const receiptId = '55555555-5555-4555-8555-555555555555';
    const query = jest.fn(async (sql: string, _parameters?: unknown[]) => {
      if (sql.includes('FROM donation_delivery')) return [{
        id: deliveryId, drive_id: '22222222-2222-4222-8222-222222222222', public_code: 'ABCDEFGH',
        donor_name: 'Người quyên góp', donor_phone: '0901234567', donor_user_id: null,
        capability_hash: hashPurposeBoundSecret(secret, 'donation-delivery', config.peppers, 'v1'), status: 'COUNTING', version: 2,
      }];
      if (sql.includes('WITH current_declaration')) return [{
        item_id: itemId, item_name: 'Nước uống', unit_code: 'BOTTLE', unit_name: 'chai', unit_scale: 2,
        declared_quantity: '3.00', counted_quantity: '3.00', accepted_quantity: '2.00',
        held_quantity: '1.00', rejected_quantity: '0.00', condition_note: 'Một chai cần kiểm tra',
        expiry_date: '2026-11-01', has_count_line: true,
      }];
      if (sql.includes('FROM donation_receipt')) return [{ id: receiptId, count_revision: 2, note: 'Ghi chú nội bộ' }];
      if (sql.includes('FROM donation_declaration')) return [{ revision: 1, created_by_kind: 'DONOR' }];
      if (sql.includes('FROM donation_line')) return [{ item_id: itemId, item_name: 'Nước uống', unit_name: 'chai', declared_quantity: '3' }];
      return [];
    });
    const service = new DonationsQueriesService({ query } as never, { require: jest.fn() } as never, config);

    const result = await service.track(deliveryId, secret, request());

    expect(result.receipt).toMatchObject({ count_revision: 2, lines: [{
      item_id: itemId, declared_quantity: '3.00', counted_quantity: '3.00', accepted_quantity: '2.00',
      held_quantity: '1.00', rejected_quantity: '0.00', condition_note: 'Một chai cần kiểm tra',
    }] });
    const receipt = result.receipt as { lines: Array<Record<string, unknown>> };
    expect(receipt).not.toHaveProperty('note');
    expect(receipt.lines[0]).not.toHaveProperty('flags');
    expect(receipt.lines[0]).not.toHaveProperty('expiry_date');
    expect(receipt.lines[0]).not.toHaveProperty('unit_code');
    expect(receipt.lines[0]).not.toHaveProperty('unit_name');
    expect(receipt.lines[0]).not.toHaveProperty('item_name');
    const lineQuery = query.mock.calls.find(([sql]) => sql.includes('WITH current_declaration'));
    expect(lineQuery?.[0]).toContain('rc.revision=COALESCE($3::integer');
    expect(lineQuery?.[1]).toEqual([deliveryId, receiptId, 2]);
  });

  it('rejects an invalid capability without exposing whether the identifier exists', async () => {
    const dataSource = { query: jest.fn(async () => [{
      id: deliveryId, drive_id: '22222222-2222-4222-8222-222222222222', public_code: 'ABCDEFGH',
      donor_name: 'Người quyên góp', donor_phone: '0901234567', donor_user_id: null,
      capability_hash: 'v1:wrong', status: 'DECLARED', version: 1,
    }]) };
    const service = new DonationsQueriesService(dataSource as never, { require: jest.fn() } as never, config);

    await expect(service.track(deliveryId, secret, request())).rejects.toMatchObject({ code: 'DONATION_SECRET_INVALID', status: 400 });
  });
});
