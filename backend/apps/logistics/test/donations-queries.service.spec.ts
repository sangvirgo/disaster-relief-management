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
