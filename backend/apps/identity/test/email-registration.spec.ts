import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createHmac } from 'node:crypto';
import argon2 from 'argon2';
import type { IdempotentCommand } from '../../../packages/technical/src/idempotency/idempotency';
import { JobRunner } from '../../../packages/technical/src/persistence/jobs';
import { AuthService } from '../src/auth/auth.service';
import { loadIdentityAuthConfig } from '../src/auth/auth-security';

const started = Date.parse('2026-10-26T00:00:00Z');
const config = { ...loadIdentityAuthConfig({ NODE_ENV: 'test' }), emailOtpPepper: 'test-only-email-otp-pepper' };
const id = '10000000-0000-4000-8000-000000000001';
const challengeId = '20000000-0000-4000-8000-000000000001';
const key = '30000000-0000-4000-8000-000000000001';
const dto = { username: 'citizen1', display_name: 'Người dân', email: 'CITIZEN@example.test', password: 'A-long-safe-password-48' };
const digest = (challenge: string, code: string) => createHmac('sha256', config.emailOtpPepper).update('c48.email-otp.v1\0').update(challenge).update('\0').update(code).digest('hex');
type Registration = {
  id: string; challenge_id: string; username: string; display_name: string; email: string; password_hash: string | null;
  code_hash: string | null; attempts: number; created_at: Date; expires_at: Date; code_expires_at: Date;
  last_sent_at: Date; confirmed_at: Date | null;
};
function fixture() {
  let now = started;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  let registration: Registration | undefined;
  const users: Array<{ id: string; username: string; display_name: string; email: string; password_hash: string }> = [];
  const grants: string[] = [];
  let failGrant = false;
  const manager = { query: jest.fn(async (sql: string, p: unknown[] = []): Promise<unknown[]> => {
    if (sql.includes('FROM email_verification_challenge c JOIN')) return registration ? [{ ...registration,
      id: registration.challenge_id, user_id: registration.id, expires_at: registration.code_expires_at,
      status: 'PENDING_EMAIL', email_verified_at: null, consumed_at: registration.confirmed_at,
    }] : [];
    if (sql.includes('SELECT') && sql.includes('FROM email_registration')) {
      return registration && (p[0] === registration.challenge_id || p[0] === registration.id) ? [{ ...registration }] : [];
    }
    if (sql.includes('SELECT') && sql.includes('FROM app_user')) return users.filter((u) => u.username.toLowerCase() === String(p[0]).toLowerCase() || u.email.toLowerCase() === String(p[1]).toLowerCase());
    if (sql.includes('INSERT INTO email_registration')) {
      registration = { id: String(p[0]), challenge_id: String(p[1]), username: String(p[2]), display_name: String(p[3]), email: String(p[4]), password_hash: String(p[5]), code_hash: String(p[6]), attempts: 0,
        created_at: new Date(now), expires_at: new Date(now + 600_000), code_expires_at: new Date(now + 300_000), last_sent_at: new Date(now), confirmed_at: null };
      return [{ id: registration.id, username: registration.username, display_name: registration.display_name }];
    }
    if (sql.includes('UPDATE app_user')) return [[{ id }], 1];
    if (sql.includes('INSERT INTO app_user')) {
      const user = { id: String(p[0]), username: String(p[1]), display_name: String(p[2]), email: String(p[3]), password_hash: String(p[4]) };
      if (users.some((u) => u.username.toLowerCase() === user.username.toLowerCase())) throw { code: '23505', constraint: 'app_user_username_key' };
      if (users.some((u) => u.email.toLowerCase() === user.email.toLowerCase())) throw { code: '23505', constraint: 'app_user_email_lower_uq' };
      users.push(user); return [{ id: user.id, username: user.username, display_name: user.display_name }];
    }
    if (sql.includes('INSERT INTO role_grant')) { if (failGrant) throw new Error('grant failure'); grants.push(String(p[0])); return []; }
    if (sql.includes('UPDATE email_registration') && registration) {
      if (sql.includes('attempts=attempts+1')) registration.attempts++;
      else if (sql.includes('confirmed_at=now()')) { registration.confirmed_at = new Date(now); registration.code_hash = null; registration.password_hash = null; }
      else if (sql.includes('challenge_id=$2')) {
        registration.challenge_id = String(p[1]); registration.code_hash = String(p[2]); registration.attempts = 0;
        registration.last_sent_at = new Date(now); registration.code_expires_at = new Date(Math.min(now + 300_000, registration.expires_at.getTime()));
      }
      return [[], 1];
    }
    return [];
  }) };
  const source = { transaction: async <T>(work: (m: typeof manager) => Promise<T>) => {
    const oldUsers = [...users], oldGrants = [...grants], oldRegistration = registration ? { ...registration } : undefined;
    try { return await work(manager); } catch (error) { users.splice(0, users.length, ...oldUsers); grants.splice(0, grants.length, ...oldGrants); registration = oldRegistration; throw error; }
  } };
  const commands = new Map<string, { resource: { type: string; id: string } | null; status: number }>();
  const idempotency = { execute: async <T>(_source: unknown, command: IdempotentCommand<T>) => {
    const previous = commands.get(command.key);
    if (previous) return { status: previous.status, value: await command.replay(manager as never, previous.resource, previous.status), replay: true };
    const outcome = await source.transaction((m) => command.execute(m as never));
    commands.set(command.key, { resource: outcome.resource, status: outcome.status });
    return { status: outcome.status, value: outcome.value, replay: false };
  } };
  const sender = { sendVerificationCode: jest.fn(async (_email: string, _code: string) => true) };
  const service = new AuthService(source as never, idempotency as never, config, sender as never);
  return { service, manager, users, grants, sender, advance: (ms: number) => { now += ms; }, failGrant: () => { failGrant = true; },
    get registration() { return registration; },
    seed: () => { registration = { id, challenge_id: challengeId, username: dto.username, display_name: dto.display_name, email: dto.email.toLowerCase(), password_hash: '$argon2id$test-hash', code_hash: digest(challengeId, '123456'), attempts: 0, created_at: new Date(now), expires_at: new Date(now + 600_000), code_expires_at: new Date(now + 300_000), last_sent_at: new Date(now), confirmed_at: null }; },
  };
}
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

describe('email registration lifetime and verification', () => {
  it('creates the account and citizen grant atomically with real driver UPDATE tuples', async () => {
    const f = fixture(); f.seed();
    await expect(f.service.verifyEmail(challengeId, '123456', 'ip')).resolves.toMatchObject({ verified: true, user: { id } });
    expect(f.grants).toEqual([id]);
  });

  it('keeps signup outside app_user and stores only a password hash until verification', async () => {
    const f = fixture();
    const registered = await f.service.register(dto, key, 'ip');
    expect(f.users).toHaveLength(0); expect(f.grants).toHaveLength(0);
    expect(registered.value.user.id).toBe(f.registration?.id);
    expect(await argon2.verify(f.registration!.password_hash!, dto.password)).toBe(true);
    const code = f.sender.sendVerificationCode.mock.calls[0]![1];
    await expect(f.service.verifyEmail(registered.value.verification.challenge_id, code, 'ip')).resolves.toMatchObject({ user: registered.value.user });
    expect(f.users).toHaveLength(1); expect(f.grants).toEqual([registered.value.user.id]);
    expect(f.registration).toMatchObject({ password_hash: null, code_hash: null });
  });

  it('does not let unverified attempts reserve the same identifiers', async () => {
    const f = fixture();
    await f.service.register(dto, key, 'ip');
    await expect(f.service.register(dto, '30000000-0000-4000-8000-000000000002', 'ip')).resolves.toMatchObject({ status: 201 });
    expect(f.users).toHaveLength(0);
  });

  it('expires verification, resend and idempotent replay at ten minutes while allowing a fresh registration', async () => {
    const f = fixture(); const initial = await f.service.register(dto, key, 'ip');
    const code = f.sender.sendVerificationCode.mock.calls[0]![1];
    f.advance(600_000);
    await expect(f.service.verifyEmail(initial.value.verification.challenge_id, code, 'ip')).rejects.toMatchObject({ code: 'EMAIL_OTP_INVALID', status: 400 });
    await expect(f.service.resendEmailOtp(initial.value.verification.challenge_id, 'ip')).resolves.toEqual({ challenge_id: null, email_sent: false });
    await expect(f.service.register(dto, key, 'ip')).rejects.toMatchObject({ code: 'REGISTRATION_EXPIRED', status: 410 });
    await expect(f.service.register(dto, '30000000-0000-4000-8000-000000000002', 'ip')).resolves.toMatchObject({ status: 201 });
    expect(f.users).toHaveLength(0);
  });

  it('rejects expired, wrong, exhausted and reused OTPs without granting access', async () => {
    const f = fixture(); f.seed();
    for (let i = 0; i < 5; i++) await expect(f.service.verifyEmail(challengeId, '000000', 'ip')).rejects.toMatchObject({ code: 'EMAIL_OTP_INVALID' });
    await expect(f.service.verifyEmail(challengeId, '123456', 'ip')).rejects.toMatchObject({ code: 'EMAIL_OTP_INVALID' });
    expect(f.registration?.attempts).toBe(5); expect(f.users).toHaveLength(0); expect(f.grants).toHaveLength(0);
  });

  it('rejects a five-minute-old code and invalidates the previous challenge on resend', async () => {
    const f = fixture(); f.seed(); f.advance(300_000);
    await expect(f.service.verifyEmail(challengeId, '123456', 'ip')).rejects.toMatchObject({ code: 'EMAIL_OTP_INVALID' });
    const resent = await f.service.resendEmailOtp(challengeId, 'ip');
    await expect(f.service.verifyEmail(challengeId, '123456', 'ip')).rejects.toMatchObject({ code: 'EMAIL_OTP_INVALID' });
    const code = f.sender.sendVerificationCode.mock.calls[0]![1];
    await f.service.verifyEmail(resent.challenge_id!, code, 'ip');
    await expect(f.service.verifyEmail(resent.challenge_id!, '000000', 'ip')).rejects.toMatchObject({ code: 'EMAIL_OTP_INVALID' });
    await expect(f.service.verifyEmail(resent.challenge_id!, code, 'ip')).rejects.toMatchObject({ code: 'EMAIL_OTP_INVALID' });
    expect(f.users).toHaveLength(1); expect(f.grants).toHaveLength(1);
  });

  it('enforces resend cooldown and hourly IP/email limits without extending registration expiry', async () => {
    const f = fixture(); f.seed();
    await expect(f.service.resendEmailOtp(challengeId, 'ip')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    f.advance(540_000);
    let challenge = (await f.service.resendEmailOtp(challengeId, 'ip2')).challenge_id!;
    expect(f.registration?.expires_at.getTime()).toBe(started + 600_000);
    expect(f.registration?.code_expires_at.getTime()).toBe(started + 600_000);
    // Separate fixture keeps the final minute test independent of the hourly budget.
    const g = fixture(); g.seed();
    for (let i = 0; i < 3; i++) { g.advance(60_000); challenge = (await g.service.resendEmailOtp(i === 0 ? challengeId : challenge, 'ip')).challenge_id!; }
    g.advance(60_000);
    await expect(g.service.resendEmailOtp(challenge, 'ip')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(g.service.resendEmailOtp(challenge, 'another-ip')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it.each(['username', 'email'])('preserves verified %s uniqueness when a competing account is created', async (field) => {
    const f = fixture(); f.seed();
    f.users.push({ id: 'other', username: field === 'username' ? dto.username : 'other', display_name: 'Khác', email: field === 'email' ? dto.email.toLowerCase() : 'other@example.test', password_hash: 'hash' });
    await expect(f.service.verifyEmail(challengeId, '123456', 'ip')).rejects.toMatchObject({ code: field === 'username' ? 'USERNAME_TAKEN' : 'EMAIL_TAKEN', status: 409 });
    expect(f.users).toHaveLength(1); expect(f.grants).toHaveLength(0); expect(f.registration?.confirmed_at).toBeNull();
  });

  it('rolls back account creation and OTP consumption when the citizen grant fails', async () => {
    const f = fixture(); f.seed(); f.failGrant();
    await expect(f.service.verifyEmail(challengeId, '123456', 'ip')).rejects.toThrow('grant failure');
    expect(f.users).toHaveLength(0); expect(f.grants).toHaveLength(0); expect(f.registration?.confirmed_at).toBeNull();
  });
});


describe('email registration cleanup', () => {
  it('does not start a cleanup timer when scheduling is disabled', async () => {
    jest.replaceProperty(process, 'env', { ...process.env, SCHEDULER_ENABLED: 'false' });
    jest.useFakeTimers();
    const f = fixture();
    await f.service.onModuleInit();
    expect(jest.getTimerCount()).toBe(0);
    f.service.onModuleDestroy();
  });
  it('schedules bounded cleanup of only ephemeral registration rows', async () => {
    const stop = jest.fn();
    const schedule = jest.spyOn(JobRunner.prototype, 'schedule').mockReturnValue(stop);
    const f = fixture();
    await f.service.onModuleInit();
    expect(schedule).toHaveBeenCalledWith('identity.email-registration.cleanup', 60_000, expect.any(Function));
    const query = jest.fn(async (_sql: string) => []);
    await schedule.mock.calls[0]![2]({ query } as never);
    const sql = query.mock.calls[0]![0];
    expect(sql).toMatch(/WHERE expires_at<=clock_timestamp\(\)/u);
    expect(sql).toMatch(/LIMIT 100 FOR UPDATE SKIP LOCKED/u);
    expect(sql.match(/DELETE FROM [a-z_]+/gu)).toEqual(['DELETE FROM email_registration']);
    expect(sql).not.toMatch(/app_user|role_grant|session_family/u);
    f.service.onModuleDestroy();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
