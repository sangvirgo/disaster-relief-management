import { describe, expect, it } from '@jest/globals';
import { generateKeyPairSync, sign } from 'node:crypto';
import { verifyServiceToken } from '../src/security/service-token';
import type { ServiceName, ServiceTokenClaims } from '../src/security/service-token';

const now = 1_800_000_000_000;
const pair = generateKeyPairSync('rsa', { modulusLength: 3072, publicExponent: 0x10001 });
const config = { issuer: 'https://c48.test', publicKey: pair.publicKey };

function serviceToken(claims: Partial<ServiceTokenClaims> = {}): string {
  const payload: ServiceTokenClaims = {
    iss: config.issuer,
    aud: 'response',
    sub: 'identity',
    iat: now / 1_000,
    exp: now / 1_000 + 300,
    jti: '00000000-0000-4000-8000-000000000001',
    ...claims,
  };
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const unsigned = `${header}.${body}`;
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), pair.privateKey).toString('base64url')}`;
}

const allowedCallers: readonly ServiceName[] = ['identity', 'logistics'];

describe('shared service-token verifier', () => {
  it('verifies a valid caller and audience', () => {
    expect(verifyServiceToken(serviceToken(), config, 'response', allowedCallers, now)).toMatchObject({
      iss: config.issuer, aud: 'response', sub: 'identity', exp: now / 1_000 + 300,
    });
  });

  it('rejects a malformed token as unauthenticated', () => {
    expect(() => verifyServiceToken('invalid', config, 'response', allowedCallers, now))
      .toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED', status: 401 }));
  });

  it('rejects an expired token as unauthenticated', () => {
    expect(() => verifyServiceToken(serviceToken(), config, 'response', allowedCallers, now + 300_000))
      .toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED', status: 401 }));
  });

  it('rejects the wrong audience as unauthenticated', () => {
    expect(() => verifyServiceToken(serviceToken({ aud: 'identity' }), config, 'response', allowedCallers, now))
      .toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED', status: 401 }));
  });

  it('rejects a valid but disallowed caller as unauthenticated', () => {
    expect(() => verifyServiceToken(serviceToken({ sub: 'response' }), config, 'response', allowedCallers, now))
      .toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED', status: 401 }));
  });
});
