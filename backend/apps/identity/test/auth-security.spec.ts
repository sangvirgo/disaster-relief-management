import { describe, expect, it } from '@jest/globals';
import {
  assertStrongPassword,
  createCsrfToken,
  issueAccessToken,
  loadIdentityAuthConfig,
  parseCookies,
  verifyAccessToken,
  verifyCsrfToken,
  WindowRateLimiter,
} from '../src/auth/auth-security';

const config = loadIdentityAuthConfig({ NODE_ENV: 'test' });

describe('Identity auth security primitives', () => {
  it('issues only short-lived RS256 access tokens and rejects tampering or wrong audiences', () => {
    const issuedAt = 1_800_000_000_000;
    const token = issueAccessToken(config, {
      userId: '00000000-0000-4000-8000-000000000101',
      familyId: '00000000-0000-4000-8000-000000000201',
      absoluteExpiresAt: new Date(issuedAt + 7 * 24 * 60 * 60 * 1_000),
      now: issuedAt,
    });
    expect(verifyAccessToken(token, config, issuedAt)).toMatchObject({
      sub: '00000000-0000-4000-8000-000000000101',
      sid: '00000000-0000-4000-8000-000000000201',
      iss: config.issuer,
      aud: config.audience,
      exp: Math.floor(issuedAt / 1_000) + 600,
    });
    const [header, payload, signature] = token.split('.');
    const tampered = `${header}.${Buffer.from(JSON.stringify({ sub: 'attacker' })).toString('base64url')}.${signature}`;
    expect(() => verifyAccessToken(tampered, config, issuedAt)).toThrow(expect.objectContaining({ code: 'SESSION_EXPIRED' }));
    expect(() => verifyAccessToken(token, { ...config, audience: 'other-service' }, issuedAt))
      .toThrow(expect.objectContaining({ code: 'SESSION_EXPIRED' }));
    expect(() => verifyAccessToken(token, config, issuedAt + 601_000))
      .toThrow(expect.objectContaining({ code: 'SESSION_EXPIRED' }));
  });

  it('binds CSRF tokens to a browser pre-session and parses cookies without decoding secrets', () => {
    const token = createCsrfToken(config, 'pre-session-a');
    expect(verifyCsrfToken(config, 'pre-session-a', token)).toBe(true);
    expect(verifyCsrfToken(config, 'pre-session-b', token)).toBe(false);
    expect(verifyCsrfToken(config, 'pre-session-a', token.slice(0, -1) + 'x')).toBe(false);
    expect([...parseCookies('c48_access=opaque; c48_csrf=a%2Fb; malformed')])
      .toEqual([['c48_access', 'opaque'], ['c48_csrf', 'a%2Fb']]);
  });

  it('rejects short, common, and username-matching passwords', () => {
    expect(() => assertStrongPassword('long-enough-safe-phrase', 'citizen1')).not.toThrow();
    for (const password of ['short', 'Password123', 'CITIZEN1']) {
      expect(() => assertStrongPassword(password, 'citizen1')).toThrow(expect.objectContaining({ code: 'PASSWORD_WEAK' }));
    }
  });

  it('bounds login attempts and reports the remaining retry window', () => {
    let now = 10_000;
    const limiter = new WindowRateLimiter(() => now, 4);
    expect(limiter.consume('login', 2, 1_000)).toBe(0);
    expect(limiter.consume('login', 2, 1_000)).toBe(0);
    expect(limiter.consume('login', 2, 1_000)).toBe(1);
    now += 1_000;
    expect(limiter.consume('login', 2, 1_000)).toBe(0);
  });
});
