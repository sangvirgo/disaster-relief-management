import { jest } from '@jest/globals';
import { DonationsService } from '../src/drives/donations.service';
import { hashPurposeBoundSecret } from '@c48/technical/security/secret-hash';

const deliveryId = '44444444-4444-4444-8444-444444444444';
const userId = '11111111-1111-4111-8111-111111111111';
const key = '55555555-5555-4555-8555-555555555555';
const secret = Buffer.alloc(32, 7).toString('base64url');
const config = { peppers: { v1: 'test-donation-secret-pepper-that-is-long-enough' }, currentPepperVersion: 'v1' };
const delivery = {
  id: deliveryId, public_code: 'ABCDEFGH', organization_id: userId, region_code: 'R1',
  donor_user_id: null, capability_hash: 'v1:old-capability-hash', status: 'DECLARED', version: 3,
};

interface RecoveryServiceUnderTest {
  issueRecovery(...args: unknown[]): Promise<unknown>;
  recover(...args: unknown[]): Promise<unknown>;
}

function request(authorization = 'Bearer token') {
  return { method: 'POST', headers: { authorization }, idempotencyKey: key } as never;
}

function createIdempotency(manager: { query: jest.Mock }, replay = false, resourceId = deliveryId) {
  return {
    execute: jest.fn(async (_dataSource: unknown, command: {
      execute(manager: never): Promise<{ status: number; value: Record<string, unknown>; resource: { type: string; id: string } | null }>;
      replay(manager: never, resource: { type: string; id: string }, status: number): Promise<Record<string, unknown>>;
    }) => replay
      ? { status: 201, value: await command.replay(manager as never, { type: 'capability_recovery', id: resourceId }, 201), replay: true }
      : { ...(await command.execute(manager as never)), replay: false }),
  };
}

function makeService(manager: { query: jest.Mock }, idempotency = createIdempotency(manager)) {
  const sessions = { require: jest.fn(async () => ({
    userId,
    grants: [{ role_code: 'INTAKE_STAFF', scope_type: 'ORGANIZATION', organization_id: userId }],
  })) };
  const service = new DonationsService(
    { query: jest.fn(async () => [{ id: deliveryId }]) } as never,
    idempotency as never,
    sessions as never,
    config,
    { assertAllowed: jest.fn() } as never,
  );
  return { service: service as unknown as RecoveryServiceUnderTest, sessions, idempotency };
}

describe('donation capability recovery', () => {
  it('issues a short-lived hash-only code, invalidates older codes, and audits the issuance', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const manager = { query: jest.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.includes('FROM donation_delivery dd')) return [{ ...delivery }];
      if (sql.includes('INSERT INTO capability_recovery')) return [{ id: key, expires_at: '2026-10-15T12:30:00.000Z' }];
      if (sql.includes('UPDATE donation_delivery SET version')) return [[{ version: 4 }], 1];
      return [];
    }) };
    const { service } = makeService(manager as never);

    const result = await service.issueRecovery(deliveryId, {
      expected_version: 3, reason: 'Đã xác minh qua số điện thoại',
      confirmation_basis: 'Đối chiếu thông tin với người quyên góp', source_note: 'Đã gọi lại số đăng ký',
    }, request()) as { status: number; replay: boolean; value: Record<string, unknown> };

    expect(result).toMatchObject({ status: 201, replay: false, value: { issuance_id: key, expires_at: '2026-10-15T12:30:00.000Z' } });
    const recoveryInsert = calls.find(({ sql }) => sql.includes('INSERT INTO capability_recovery'))!;
    const code = result.value.recovery_code as string;
    expect(recoveryInsert.values).toContain(hashPurposeBoundSecret(code, `donation-recovery:${deliveryId}`, config.peppers, 'v1'));
    expect(recoveryInsert.values).not.toContain(code);
    expect(calls.some(({ sql }) => sql.includes('UPDATE capability_recovery SET consumed_at'))).toBe(true);
    expect(calls.some(({ sql, values }) => sql.includes('INSERT INTO audit_log') && values.includes('CAPABILITY_RECOVERY_ISSUED'))).toBe(true);
  });

  it('replays issuance metadata without revealing the one-use code', async () => {
    const manager = { query: jest.fn(async () => [{ id: key, expires_at: '2026-10-15T12:30:00.000Z' }]) };
    const { service } = makeService(manager as never, createIdempotency(manager as never, true, key));

    const result = await service.issueRecovery(deliveryId, {
      expected_version: 3, reason: 'Đã xác minh', confirmation_basis: 'Đối chiếu trực tiếp',
    }, request()) as { status: number; replay: boolean; value: Record<string, unknown> };

    expect(result).toEqual({ status: 201, replay: true, value: { issuance_id: key, expires_at: '2026-10-15T12:30:00.000Z' } });
  });

  it('binds the unowned delivery to the live session and consumes the code once', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const manager = { query: jest.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.includes('FROM donation_delivery dd')) return [{ ...delivery }];
      if (sql.includes('FROM capability_recovery') && sql.includes('code_hash=$2')) return [{ id: key }];
      if (sql.includes('UPDATE donation_delivery') && sql.includes('RETURNING')) return [[{ status: delivery.status, version: 4 }], 1];
      return [];
    }) };
    const { service, sessions } = makeService(manager as never);

    const result = await service.recover({ public_code: 'ABCDEFGH' }, secret, request()) as { status: number; replay: boolean; value: Record<string, unknown> };

    expect(sessions.require).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 200, replay: false, value: { id: deliveryId, donor_user_id: userId, capability_revoked: true, version: 4 } });
    const consume = calls.find(({ sql }) => sql.includes('UPDATE capability_recovery SET consumed_at'))!;
    expect(consume.values).toContain(userId);
    expect(calls.some(({ sql, values }) => sql.includes('UPDATE donation_delivery SET donor_user_id') && values.includes(userId))).toBe(true);
    expect(calls.some(({ sql, values }) => sql.includes('INSERT INTO audit_log') && values.includes('DONATION_CAPABILITY_RECOVERED'))).toBe(true);
    expect(calls.some(({ sql, values }) => sql.includes('code_hash=$2') && values.includes(hashPurposeBoundSecret(secret, `donation-recovery:${deliveryId}`, config.peppers, 'v1')))).toBe(true);
  });

  it('returns the same not-found result for an invalid recovery code', async () => {
    const manager = { query: jest.fn(async (sql: string) => sql.includes('FROM donation_delivery dd') ? [{ ...delivery }] : []) };
    const { service } = makeService(manager as never);

    await expect(service.recover({ public_code: 'ABCDEFGH' }, 'wrong-code', request()))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('returns the same not-found result for an expired one-use code', async () => {
    const calls: string[] = [];
    const manager = { query: jest.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('FROM donation_delivery dd')) return [{ ...delivery }];
      return [];
    }) };
    const { service } = makeService(manager as never);

    await expect(service.recover({ public_code: 'ABCDEFGH' }, secret, request()))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    const lookup = calls.find((sql) => sql.includes('FROM capability_recovery'));
    expect(lookup).toContain('expires_at>clock_timestamp()');
    expect(lookup).toContain('consumed_at IS NULL');
  });

  it.each([
    ['wrong', 'wrong-code'],
    ['expired', secret],
  ])('returns generic not-found for a %s code when the delivery is already claimed', async (_label, recoveryCode) => {
    const calls: string[] = [];
    const claimedDelivery = { ...delivery, donor_user_id: '22222222-2222-4222-8222-222222222222' };
    const manager = { query: jest.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('FROM donation_delivery dd')) return [claimedDelivery];
      return [];
    }) };
    const { service } = makeService(manager as never);

    await expect(service.recover({ public_code: 'ABCDEFGH' }, recoveryCode, request()))
      .rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    if (recoveryCode === secret) expect(calls.some((sql) => sql.includes('FROM capability_recovery'))).toBe(true);
    expect(calls.some((sql) => sql.includes('UPDATE capability_recovery SET consumed_at'))).toBe(false);
  });

  it('keeps a valid recovery code unconsumed when the delivery is already claimed', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const claimedDelivery = { ...delivery, donor_user_id: '22222222-2222-4222-8222-222222222222' };
    const manager = { query: jest.fn(async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.includes('FROM donation_delivery dd')) return [claimedDelivery];
      if (sql.includes('FROM capability_recovery') && sql.includes('code_hash=$2')) return [{ id: key }];
      return [];
    }) };
    const { service } = makeService(manager as never);

    await expect(service.recover({ public_code: 'ABCDEFGH' }, secret, request()))
      .rejects.toMatchObject({ code: 'ALREADY_CLAIMED', status: 409 });
    expect(calls.some(({ sql, values }) => sql.includes('code_hash=$2') && values.includes(
      hashPurposeBoundSecret(secret, `donation-recovery:${deliveryId}`, config.peppers, 'v1'),
    ))).toBe(true);
    expect(calls.some(({ sql }) => sql.includes('UPDATE capability_recovery SET consumed_at'))).toBe(false);
  });
});
