import { generateKeyPairSync, sign } from 'node:crypto';
import type { Request } from 'express';
import { jest } from '@jest/globals';
import { AppError } from '../../../packages/technical/src/errors/errors';
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

  it('deduplicates region lookups and returns only names for requested codes', async () => {
    const service = new ReporterSessionService({
      identityBaseUrl: 'http://127.0.0.1:1', clientId: 'c48-response-test',
      clientSecret: 'test-client-secret-not-for-deployment-0001', timeoutMs: 100,
    }, intakeConfig);
    const client = (service as unknown as { client: { post: jest.Mock } }).client;
    client.post = jest.fn(async (path: string) => path.endsWith('/internal/token')
      ? { status: 200, body: { access_token: 'identity-token', expires_in: 300 } }
      : { status: 200, body: { items: [{ code: 'HCM', name: 'Thành phố Hồ Chí Minh' }] } }) as unknown as jest.Mock;

    await expect(service.lookupRegionNames(['HCM', 'HCM', 'UNKNOWN'])).resolves.toEqual(
      new Map([['HCM', 'Thành phố Hồ Chí Minh']]),
    );
    expect(client.post).toHaveBeenNthCalledWith(1, '/api/v1/identity/internal/token', {
      client_id: 'c48-response-test',
      client_secret: 'test-client-secret-not-for-deployment-0001',
      audience: 'identity',
    });
    expect(client.post).toHaveBeenNthCalledWith(2, '/api/v1/identity/internal/regions:lookup', {
      codes: ['HCM', 'UNKNOWN'],
    }, { headers: { authorization: 'Bearer identity-token' } });
    service.onModuleDestroy();
  });

  it('does not call Identity for an empty region lookup', async () => {
    const service = new ReporterSessionService({
      identityBaseUrl: 'http://127.0.0.1:1', clientId: 'c48-response-test',
      clientSecret: 'test-client-secret-not-for-deployment-0001', timeoutMs: 100,
    }, intakeConfig);
    const client = (service as unknown as { client: { post: jest.Mock } }).client;
    client.post = jest.fn() as unknown as jest.Mock;

    await expect(service.lookupRegionNames([])).resolves.toEqual(new Map());
    expect(client.post).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });

  it('caches service tokens independently for each audience', async () => {
    const service = new ReporterSessionService({
      identityBaseUrl: 'http://127.0.0.1:1', clientId: 'c48-response-test',
      clientSecret: 'test-client-secret-not-for-deployment-0001', timeoutMs: 100,
    }, intakeConfig);
    const client = (service as unknown as { client: { post: jest.Mock } }).client;
    client.post = jest.fn(async (_path: string, body: { audience?: string }) => ({
      status: 200,
      body: { access_token: `${body.audience}-token`, expires_in: 300 },
    })) as unknown as jest.Mock;
    const serviceTokens = service as unknown as {
      serviceToken(audience: 'identity' | 'logistics'): Promise<string>;
    };

    await expect(serviceTokens.serviceToken('logistics')).resolves.toBe('logistics-token');
    await expect(serviceTokens.serviceToken('identity')).resolves.toBe('identity-token');
    await expect(serviceTokens.serviceToken('logistics')).resolves.toBe('logistics-token');
    expect(client.post).toHaveBeenCalledTimes(2);
    expect(client.post).toHaveBeenNthCalledWith(1, '/api/v1/identity/internal/token', {
      client_id: 'c48-response-test',
      client_secret: 'test-client-secret-not-for-deployment-0001',
      audience: 'logistics',
    });
    expect(client.post).toHaveBeenNthCalledWith(2, '/api/v1/identity/internal/token', {
      client_id: 'c48-response-test',
      client_secret: 'test-client-secret-not-for-deployment-0001',
      audience: 'identity',
    });
    service.onModuleDestroy();
  });

  it.each([
    ['missing items', {}],
    ['malformed row', { items: [{ code: 'HCM', name: null }] }],
    ['unrequested code', { items: [{ code: 'OTHER', name: 'Other' }] }],
    ['duplicate code', { items: [{ code: 'HCM', name: 'One' }, { code: 'HCM', name: 'Two' }] }],
  ])('fails closed when the region lookup response has %s', async (_caseName, body) => {
    const service = new ReporterSessionService({
      identityBaseUrl: 'http://127.0.0.1:1', clientId: 'c48-response-test',
      clientSecret: 'test-client-secret-not-for-deployment-0001', timeoutMs: 100,
    }, intakeConfig);
    const client = (service as unknown as { client: { post: jest.Mock } }).client;
    client.post = jest.fn(async (path: string) => path.endsWith('/internal/token')
      ? { status: 200, body: { access_token: 'identity-token', expires_in: 300 } }
      : { status: 200, body }) as unknown as jest.Mock;

    await expect(service.lookupRegionNames(['HCM'])).rejects.toMatchObject({ code: 'IDENTITY_UNAVAILABLE' });
    service.onModuleDestroy();
  });

  it('maps Identity lookup outages to IDENTITY_UNAVAILABLE', async () => {
    const service = new ReporterSessionService({
      identityBaseUrl: 'http://127.0.0.1:1', clientId: 'c48-response-test',
      clientSecret: 'test-client-secret-not-for-deployment-0001', timeoutMs: 100,
    }, intakeConfig);
    const client = (service as unknown as { client: { post: jest.Mock } }).client;
    client.post = jest.fn(async (path: string) => {
      if (path.endsWith('/internal/token')) return { status: 200, body: { access_token: 'identity-token', expires_in: 300 } };
      throw new Error('Identity offline');
    }) as unknown as jest.Mock;

    await expect(service.lookupRegionNames(['HCM'])).rejects.toMatchObject({ code: 'IDENTITY_UNAVAILABLE' });
    service.onModuleDestroy();
  });
});
