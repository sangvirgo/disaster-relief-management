import { verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { AppError } from '../errors/errors';

export type ServiceName = 'identity' | 'response' | 'logistics';

export interface ServiceTokenClaims {
  iss: string;
  aud: ServiceName;
  sub: ServiceName;
  iat: number;
  exp: number;
  jti: string;
}

const services: readonly ServiceName[] = ['identity', 'response', 'logistics'];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unauthorized(): AppError {
  return new AppError('UNAUTHENTICATED', { status: 401 });
}

export function verifyServiceToken(
  token: string,
  config: { issuer: string; publicKey: KeyObject },
  audience: ServiceName,
  allowedCallers: readonly ServiceName[],
  now = Date.now(),
): ServiceTokenClaims {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw unauthorized();
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as { alg?: unknown; typ?: unknown };
    const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<ServiceTokenClaims>;
    const issuedNow = Math.floor(now / 1_000);
    if (header.alg !== 'RS256' || header.typ !== 'JWT' ||
        !verify('RSA-SHA256', Buffer.from(`${encodedHeader}.${encodedPayload}`), config.publicKey, Buffer.from(encodedSignature, 'base64url')) ||
        claims.iss !== config.issuer || claims.aud !== audience || !services.includes(claims.sub as ServiceName) ||
        !allowedCallers.includes(claims.sub as ServiceName) ||
        typeof claims.iat !== 'number' || !Number.isSafeInteger(claims.iat) || claims.iat > issuedNow + 30 ||
        typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp <= issuedNow ||
        claims.exp <= claims.iat || claims.exp > claims.iat + 300 ||
        typeof claims.jti !== 'string' || !uuidPattern.test(claims.jti)) throw unauthorized();
    return claims as ServiceTokenClaims;
  } catch {
    throw unauthorized();
  }
}
