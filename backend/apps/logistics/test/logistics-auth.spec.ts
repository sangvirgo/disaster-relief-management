import { generateKeyPairSync, sign } from 'node:crypto';
import { accessCredential, LogisticsAuthConfig } from '../src/auth/logistics-auth';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
const config: LogisticsAuthConfig = {
  issuer: 'https://identity.test',
  audience: 'c48-test',
  publicKey,
  webOrigins: new Set(['https://portal.test']),
};

function signedToken(now = Date.now()): string {
  const seconds = Math.floor(now / 1_000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: config.issuer,
    aud: config.audience,
    sub: '11111111-1111-4111-8111-111111111111',
    sid: '22222222-2222-4222-8222-222222222222',
    iat: seconds,
    exp: seconds + 600,
    jti: '33333333-3333-4333-8333-333333333333',
  })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
}

describe('Logistics session transport', () => {
  it('forwards only the verified access cookie to the Identity region catalog', () => {
    const token = signedToken();
    const credential = accessCredential({
      method: 'GET',
      headers: { cookie: `c48_access=${token}; c48_refresh=secret; c48_csrf=secret` },
    } as never, config);

    expect(credential.identityHeaders).toEqual({ cookie: `c48_access=${token}` });
    expect(credential.claims.sub).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('requires an allowed Origin and matching CSRF cookie on cookie-authenticated writes', () => {
    const token = signedToken();
    expect(() => accessCredential({
      method: 'POST',
      headers: { cookie: `c48_access=${token}; c48_pre=nonce`, origin: 'https://portal.test' },
    } as never, config)).toThrow('CSRF_INVALID');
  });

  it('rejects bearer tokens on browser-origin requests', () => {
    const token = signedToken();
    expect(() => accessCredential({
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, origin: 'https://portal.test' },
    } as never, config)).toThrow('FORBIDDEN');
  });
});
