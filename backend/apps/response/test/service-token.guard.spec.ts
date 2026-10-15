import { describe, expect, it } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import { generateKeyPairSync, sign } from 'node:crypto';
import type { RequestIntakeConfig } from '../src/requests/request-intake.service';
import { ResponseServiceTokenGuard } from '../src/campaigns/service-token.guard';
import type { ServiceName, ServiceTokenClaims } from '../../../packages/technical/src/security/service-token';

const pair = generateKeyPairSync('rsa', { modulusLength: 3072, publicExponent: 0x10001 });
const issuer = 'https://c48.test';
const config = { auth: { issuer, publicKey: pair.publicKey } } as RequestIntakeConfig;

function serviceToken(sub: ServiceName): string {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const claims: ServiceTokenClaims = {
    iss: issuer,
    aud: 'response',
    sub,
    iat: issuedAt,
    exp: issuedAt + 300,
    jti: '00000000-0000-4000-8000-000000000001',
  };
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const unsigned = `${header}.${body}`;
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), pair.privateKey).toString('base64url')}`;
}

function requestContext(authorization?: string): { request: { headers: { authorization?: string }; serviceCaller?: ServiceName }; context: ExecutionContext } {
  const request = { headers: { ...(authorization ? { authorization } : {}) } } as { headers: { authorization?: string }; serviceCaller?: ServiceName };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
  return { request, context };
}

describe('Response inbound service-token guard', () => {
  it('rejects a missing bearer token with UNAUTHENTICATED 401', () => {
    const { context } = requestContext();
    expect(() => new ResponseServiceTokenGuard(config).canActivate(context))
      .toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED', status: 401 }));
  });

  it('accepts Identity and Logistics tokens for the Response audience', () => {
    const guard = new ResponseServiceTokenGuard(config);
    for (const caller of ['identity', 'logistics'] as const) {
      const { request, context } = requestContext(`Bearer ${serviceToken(caller)}`);
      expect(guard.canActivate(context)).toBe(true);
      expect(request.serviceCaller).toBe(caller);
    }
  });

  it('rejects a valid token from a disallowed caller with UNAUTHENTICATED 401', () => {
    const { context } = requestContext(`Bearer ${serviceToken('response')}`);
    expect(() => new ResponseServiceTokenGuard(config).canActivate(context))
      .toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED', status: 401 }));
  });
});
