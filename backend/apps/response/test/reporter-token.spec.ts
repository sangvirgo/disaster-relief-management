import { generateKeyPairSync, sign } from 'node:crypto';
import { loadReporterTokenConfig, verifyReporterAccessToken } from '../src/requests/reporter-token';

const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
const config = loadReporterTokenConfig({
  JWT_ISSUER: 'https://c48.test',
  JWT_AUDIENCE: 'c48-test',
  JWT_PUBLIC_KEY: Buffer.from(pair.publicKey.export({ type: 'spki', format: 'pem' })).toString('base64'),
  WEB_ALLOWED_ORIGINS: 'https://c48.test',
});

function accessToken(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: config.issuer,
    aud: config.audience,
    sub: '00000000-0000-4000-8000-000000000001',
    sid: '00000000-0000-4000-8000-000000000002',
    iat: now,
    exp: now + 300,
    jti: '00000000-0000-4000-8000-000000000003',
    ...overrides,
  })).toString('base64url');
  const signed = `${header}.${payload}`;
  return `${signed}.${sign('RSA-SHA256', Buffer.from(signed), pair.privateKey).toString('base64url')}`;
}

describe('Response optional reporter token verification', () => {
  it('validates a signed Identity access token without querying a session store', () => {
    expect(verifyReporterAccessToken(accessToken(), config).sub).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('rejects expired and wrong-audience tokens', () => {
    const now = Math.floor(Date.now() / 1_000);
    expect(() => verifyReporterAccessToken(accessToken({ exp: now - 1 }), config)).toThrow();
    expect(() => verifyReporterAccessToken(accessToken({ aud: 'another-service' }), config)).toThrow();
  });
});
