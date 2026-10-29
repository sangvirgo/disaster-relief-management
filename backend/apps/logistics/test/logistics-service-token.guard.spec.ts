import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { jest } from '@jest/globals';
import { AppError } from '@c48/technical/errors/errors';
import { LogisticsServiceTokenGuard } from '../src/auth/logistics-service-token.guard';

describe('LogisticsServiceTokenGuard', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const config = { issuer: 'https://identity.test', publicKey };

  function token(sub: string, aud = 'logistics'): string {
    const issuedAt = Math.floor(Date.now() / 1_000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: config.issuer,
      aud,
      sub,
      iat: issuedAt,
      exp: issuedAt + 300,
      jti: randomUUID(),
    })).toString('base64url');
    const unsigned = `${header}.${payload}`;
    return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url')}`;
  }

  function context(authorization?: string) {
    const request: { headers: Record<string, string>; serviceCaller?: string } = { headers: {} };
    if (authorization) request.headers.authorization = authorization;
    return { request, context: { switchToHttp: () => ({ getRequest: () => request }) } as never };
  }

  it('accepts a Logistics audience token issued for Response and records its caller', () => {
    const { request, context: executionContext } = context(`Bearer ${token('response')}`);
    const guard = new LogisticsServiceTokenGuard(config);

    expect(guard.canActivate(executionContext)).toBe(true);
    expect(request.serviceCaller).toBe('response');
  });

  it('rejects missing, wrong audience, and non-Response service tokens', () => {
    const guard = new LogisticsServiceTokenGuard(config);
    const missing = context();
    expect(() => guard.canActivate(missing.context)).toThrow(AppError);
    expect(() => guard.canActivate(context(`Bearer ${token('response', 'identity')}`).context)).toThrow(AppError);
    expect(() => guard.canActivate(context(`Bearer ${token('identity')}`).context)).toThrow(AppError);
  });
});
