import { generateKeyPairSync, sign } from 'node:crypto';
import type { Request } from 'express';
import { AppError } from '../../../packages/technical/src/errors';
import { ReporterSessionService } from '../src/requests/reporter-session';
import { loadReporterTokenConfig } from '../src/requests/reporter-token';
import type { RequestIntakeConfig } from '../src/requests/request-intake.service';

const pair = generateKeyPairSync('rsa', { modulusLength: 3072 });
const auth = loadReporterTokenConfig({
  JWT_ISSUER: 'https://c48.test',
  JWT_AUDIENCE: 'c48-test',
  JWT_PUBLIC_KEY: Buffer.from(pair.publicKey.export({ type: 'spki', format: 'pem' })).toString('base64'),
  WEB_ALLOWED_ORIGINS: 'https://c48.test',
});
const intakeConfig: RequestIntakeConfig = {
  auth,
  organizationId: '00000000-0000-4000-8000-000000000004',
  peppers: { v1: 'test-pepper-not-for-deployment-0001' },
  globalLimitPerMinute: 300,
  softLimitPerMinute: 30,
  proxyOpenCap: 3,
  proxyDailySoftLimit: 10,
};

function accessToken(): string {
  const now = Math.floor(Date.now() / 1_000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: auth.issuer, aud: auth.audience,
    sub: '00000000-0000-4000-8000-000000000001',
    sid: '00000000-0000-4000-8000-000000000002',
    iat: now, exp: now + 300,
    jti: '00000000-0000-4000-8000-000000000003',
  })).toString('base64url');
  const value = `${header}.${payload}`;
  return `${value}.${sign('RSA-SHA256', Buffer.from(value), pair.privateKey).toString('base64url')}`;
}

describe('Response optional reporter session', () => {
  it('uses tracking capabilities without calling Identity and fails closed for session access', async () => {
    const service = new ReporterSessionService({
      identityBaseUrl: 'http://127.0.0.1:1', clientId: 'c48-response-test',
      clientSecret: 'test-client-secret-not-for-deployment-0001', timeoutMs: 100,
    }, intakeConfig);
    let introspectionCalls = 0;
    service['introspect'] = async () => {
      introspectionCalls++;
      throw new AppError('IDENTITY_UNAVAILABLE', { status: 503 });
    };
    const request = { method: 'GET', headers: { authorization: `Bearer ${accessToken()}` } } as Request;

    await expect(service.optional(request, true)).resolves.toBeNull();
    expect(introspectionCalls).toBe(0);
    await expect(service.optional(request)).rejects.toMatchObject({ code: 'IDENTITY_UNAVAILABLE' });
    expect(introspectionCalls).toBe(1);
    service.onModuleDestroy();
  });
});
