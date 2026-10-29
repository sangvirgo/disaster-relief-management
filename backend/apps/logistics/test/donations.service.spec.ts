import { jest } from '@jest/globals';
import { DonationsService } from '../src/drives/donations.service';
import { hashPurposeBoundSecret } from '@c48/technical/security/secret-hash';

const driveId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';
const deliveryId = '44444444-4444-4444-8444-444444444444';
const userId = '11111111-1111-4111-8111-111111111111';
const key = '55555555-5555-4555-8555-555555555555';
const secret = Buffer.alloc(32, 7).toString('base64url');
const config = { peppers: { v1: 'test-donation-secret-pepper-that-is-long-enough' }, currentPepperVersion: 'v1' };

function request(authorization?: string) {
  return {
    method: 'POST',
    headers: { ...(authorization ? { authorization } : {}) },
    idempotencyKey: key,
  } as never;
}

function idempotency(manager: { query: jest.Mock }) {
  return {
    execute: jest.fn(async (_dataSource: unknown, command: {
      execute(manager: never): Promise<{ status: number; value: Record<string, unknown>; resource: { type: string; id: string } | null }>;
    }) => ({ ...(await command.execute(manager as never)), replay: false })),
  };
}

describe('Logistics donor declarations', () => {
  it('stores a purpose-bound guest capability and creates only a declaration revision', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const manager = { query: jest.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.includes('FROM donation_drive') && sql.includes('FOR UPDATE')) {
        return [{ id: driveId, organization_id: userId, status: 'OPEN', opens_at: null, closes_at: null, version: 1 }];
      }
      if (sql.includes('FROM drive_item')) return [{ item_id: itemId, target_quantity: '8', accepted_total: '2', scale: 0 }];
      if (sql.includes('INSERT INTO donation_delivery')) return [{ id: deliveryId, public_code: 'ABCDEFGH' }];
      if (sql.includes('SELECT max(revision)')) return [{ revision: 0 }];
      if (sql.includes('FROM donation_delivery') && sql.includes('WHERE id=$1')) {
        return [{ id: deliveryId, public_code: 'ABCDEFGH', status: 'DECLARED', version: 1 }];
      }
      return [];
    }) };
    const dataSource = { query: jest.fn(async (sql: string) => sql.includes('FROM donation_drive')
      ? [{ id: driveId, organization_id: userId, status: 'OPEN', version: 1 }]
      : []) };
    const idempotencyService = idempotency(manager);
    const sessions = { require: jest.fn(async () => ({ userId, grants: [] })) };
    const phoneThrottle = { assertAllowed: jest.fn() };
    const service = new DonationsService(dataSource as never, idempotencyService as never, sessions as never, config, phoneThrottle as never);

    const result = await service.createDelivery(driveId, {
      donor_name: 'Người quyên góp', donor_phone: '0901234567',
      lines: [{ item_id: itemId, declared_quantity: '3' }],
    }, secret, request());

    expect(result.value).toEqual({ id: deliveryId, public_code: 'ABCDEFGH', status: 'DECLARED', declaration_revision: 1 });
    const deliveryInsert = calls.find(({ sql }) => sql.includes('INSERT INTO donation_delivery'))!;
    expect(deliveryInsert.values).not.toContain(secret);
    expect(String(deliveryInsert.values)).toContain('v1:');
    expect(calls.some(({ sql }) => sql.includes('INSERT INTO stock_movement'))).toBe(false);
    expect(idempotencyService.execute).toHaveBeenCalledTimes(1);
    expect(phoneThrottle.assertAllowed).toHaveBeenCalledWith('0901234567');

    await expect(service.createDelivery(driveId, {
      donor_name: 'Người quyên góp đã đăng nhập', donor_phone: '0901234567',
      lines: [{ item_id: itemId, declared_quantity: '3' }],
    }, undefined, request('Bearer donor-token'))).resolves.toMatchObject({ status: 201 });
    expect(phoneThrottle.assertAllowed).toHaveBeenCalledTimes(2);
  });

  it('rejects declaration edits after counting has started', async () => {
    const manager = { query: jest.fn(async (sql: string) => sql.includes('FROM donation_delivery')
      ? [{ id: deliveryId, donor_user_id: null, capability_hash: hashPurposeBoundSecret(secret, 'donation-delivery', config.peppers, 'v1'), status: 'COUNTING', version: 1 }]
      : []) };
    const sessions = { require: jest.fn() };
    const service = new DonationsService(
      { query: jest.fn() } as never,
      idempotency(manager) as never,
      sessions as never,
      config,
      { assertAllowed: jest.fn() } as never,
    );

    await expect(service.reviseDeclaration(deliveryId, { expected_version: 1, lines: [{ item_id: itemId, declared_quantity: '2' }] }, secret, request()))
      .rejects.toMatchObject({ code: 'DECLARATION_LOCKED', status: 409 });
    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it('requires a valid donation secret before starting a guest declaration', async () => {
    const idempotencyService = { execute: jest.fn() };
    const service = new DonationsService(
      { query: jest.fn() } as never,
      idempotencyService as never,
      { require: jest.fn() } as never,
      config,
      { assertAllowed: jest.fn() } as never,
    );

    await expect(service.createDelivery(driveId, {
      donor_name: 'Người quyên góp', donor_phone: '0901234567',
      lines: [{ item_id: itemId, declared_quantity: '3' }],
    }, 'short-secret', request())).rejects.toMatchObject({ code: 'DONATION_SECRET_INVALID', status: 400 });
    expect(idempotencyService.execute).not.toHaveBeenCalled();
  });

});
