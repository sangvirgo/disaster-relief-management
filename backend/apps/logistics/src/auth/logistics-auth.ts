import { createPublicKey, KeyObject, timingSafeEqual, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Request } from 'express';
import { AppError } from '../../../../packages/technical/src/errors/errors';

export interface LogisticsAuthConfig {
  issuer: string;
  audience: string;
  publicKey: KeyObject;
  webOrigins: ReadonlySet<string>;
}

export interface LogisticsAccessTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  sid: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface AccessCredential {
  claims: LogisticsAccessTokenClaims;
  identityHeaders: Record<string, string>;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function cookieValues(header: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0) values.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return values;
}

function verifyCsrf(request: Request, config: LogisticsAuthConfig, cookies: Map<string, string>): boolean {
  const origin = headerValue(request.headers.origin);
  const cookieToken = cookies.get('c48_csrf');
  const headerToken = headerValue(request.headers['x-csrf-token']);
  if (!origin || !config.webOrigins.has(origin) || !cookies.has('c48_pre') || !cookieToken || !headerToken) return false;
  const expected = Buffer.from(cookieToken);
  const received = Buffer.from(headerToken);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function loadLogisticsAuthConfig(env: Record<string, string | undefined> = process.env): LogisticsAuthConfig {
  const issuer = env.JWT_ISSUER ?? '';
  const audience = env.JWT_AUDIENCE ?? '';
  const webOrigins = new Set((env.WEB_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean));
  try {
    const encodedKey = env.JWT_PUBLIC_KEY ?? '';
    const key = encodedKey ? Buffer.from(encodedKey, 'base64') : env.JWT_PUBLIC_KEY_FILE ? readFileSync(env.JWT_PUBLIC_KEY_FILE) : undefined;
    if (!key) throw new Error('invalid');
    const publicKey = createPublicKey(key);
    const nodeEnv = env.NODE_ENV ?? 'development';
    if (publicKey.asymmetricKeyType !== 'rsa' || Number(publicKey.asymmetricKeyDetails?.modulusLength) < 3072 ||
        !issuer || !audience || /\s/u.test(issuer) || /\s/u.test(audience) || webOrigins.size === 0 ||
        [...webOrigins].some((origin) => {
          const url = new URL(origin);
          return url.origin !== origin || !['https:', ...(nodeEnv === 'development' || nodeEnv === 'test' ? ['http:'] : [])].includes(url.protocol);
        })) throw new Error('invalid');
    return { issuer, audience, publicKey, webOrigins };
  } catch {
    throw new Error('Invalid Logistics auth configuration: JWT_ISSUER, JWT_AUDIENCE, JWT_PUBLIC_KEY, WEB_ALLOWED_ORIGINS');
  }
}

function verifyAccessToken(token: string, config: LogisticsAuthConfig, now: number): LogisticsAccessTokenClaims {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('invalid');
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as { alg?: unknown; typ?: unknown };
    const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<LogisticsAccessTokenClaims>;
    const nowSeconds = Math.floor(now / 1_000);
    if (header.alg !== 'RS256' || header.typ !== 'JWT' ||
        !verify('RSA-SHA256', Buffer.from(`${encodedHeader}.${encodedPayload}`), config.publicKey, Buffer.from(encodedSignature, 'base64url')) ||
        claims.iss !== config.issuer || claims.aud !== config.audience ||
        typeof claims.sub !== 'string' || !uuidPattern.test(claims.sub) ||
        typeof claims.sid !== 'string' || !uuidPattern.test(claims.sid) ||
        typeof claims.iat !== 'number' || !Number.isSafeInteger(claims.iat) || claims.iat > nowSeconds + 30 ||
        typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) || claims.exp <= nowSeconds ||
        claims.exp <= claims.iat || claims.exp > claims.iat + 600 ||
        typeof claims.jti !== 'string' || !uuidPattern.test(claims.jti)) throw new Error('invalid');
    return claims as LogisticsAccessTokenClaims;
  } catch {
    throw new AppError('UNAUTHENTICATED', { status: 401 });
  }
}

export function accessCredential(request: Request, config: LogisticsAuthConfig, now = Date.now()): AccessCredential {
  const authorization = headerValue(request.headers.authorization);
  const cookieHeader = headerValue(request.headers.cookie);
  if (authorization && cookieHeader) throw new AppError('FORBIDDEN', { status: 403 });

  let token: string | undefined;
  let identityHeaders: Record<string, string>;
  if (authorization) {
    if (headerValue(request.headers.origin)) throw new AppError('FORBIDDEN', { status: 403 });
    token = authorization.match(/^Bearer ([A-Za-z0-9_.-]+)$/iu)?.[1];
    if (!token) throw new AppError('UNAUTHENTICATED', { status: 401 });
    identityHeaders = { authorization: `Bearer ${token}` };
  } else if (cookieHeader) {
    const cookies = cookieValues(cookieHeader);
    const origin = headerValue(request.headers.origin);
    const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase());
    if (safeMethod && origin && !config.webOrigins.has(origin)) throw new AppError('FORBIDDEN', { status: 403 });
    if (!safeMethod && !verifyCsrf(request, config, cookies)) throw new AppError('CSRF_INVALID', { status: 403 });
    token = cookies.get('c48_access');
    if (token) identityHeaders = { cookie: `c48_access=${token}` };
    else throw new AppError('UNAUTHENTICATED', { status: 401 });
  } else {
    throw new AppError('UNAUTHENTICATED', { status: 401 });
  }

  return { claims: verifyAccessToken(token, config, now), identityHeaders };
}
