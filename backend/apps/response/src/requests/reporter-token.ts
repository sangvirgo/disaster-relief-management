import { createPublicKey, KeyObject, timingSafeEqual, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Request } from 'express';
import { AppError } from '../../../../packages/technical/src/errors/errors';

export interface ReporterTokenConfig {
  issuer: string;
  audience: string;
  publicKey: KeyObject;
  webOrigins: ReadonlySet<string>;
}

export interface ReporterAccessTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  sid: string;
  iat: number;
  exp: number;
  jti: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function loadReporterTokenConfig(env: Record<string, string | undefined> = process.env): ReporterTokenConfig {
  const issuer = env.JWT_ISSUER ?? '';
  const audience = env.JWT_AUDIENCE ?? '';
  const encodedKey = env.JWT_PUBLIC_KEY ?? '';
  const publicKeyFile = env.JWT_PUBLIC_KEY_FILE;
  const webOrigins = new Set((env.WEB_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean));
  try {
    const key = encodedKey ? Buffer.from(encodedKey, 'base64') : publicKeyFile ? readFileSync(publicKeyFile) : undefined;
    if (!key) throw new Error('missing');
    const publicKey = createPublicKey(key);
    const nodeEnv = env.NODE_ENV ?? 'development';
    if (publicKey.asymmetricKeyType !== 'rsa' || Number(publicKey.asymmetricKeyDetails?.modulusLength) < 3072 ||
        !issuer || !audience || /\s/.test(issuer) || /\s/.test(audience) || webOrigins.size === 0 ||
        [...webOrigins].some((origin) => {
          const url = new URL(origin);
          return url.origin !== origin || !['https:', ...(nodeEnv === 'development' || nodeEnv === 'test' ? ['http:'] : [])].includes(url.protocol);
        })) throw new Error('invalid');
    return { issuer, audience, publicKey, webOrigins };
  } catch {
    throw new Error('Invalid Response token configuration: JWT_ISSUER, JWT_AUDIENCE, JWT_PUBLIC_KEY, WEB_ALLOWED_ORIGINS');
  }
}

export function verifyReporterAccessToken(token: string, config: ReporterTokenConfig, now = Date.now()): ReporterAccessTokenClaims {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('invalid');
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as { alg?: unknown; typ?: unknown };
    const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<ReporterAccessTokenClaims>;
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
    return claims as ReporterAccessTokenClaims;
  } catch {
    throw new AppError('UNAUTHENTICATED', { status: 401 });
  }
}

function cookies(header: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0) values.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return values;
}

function validDoubleSubmitCsrf(request: Request, config: ReporterTokenConfig, values: Map<string, string>): boolean {
  const origin = headerValue(request.headers.origin);
  const cookieToken = values.get('c48_csrf');
  const headerToken = headerValue(request.headers['x-csrf-token']);
  if (!origin || !config.webOrigins.has(origin) || !values.has('c48_pre') || !cookieToken || !headerToken) return false;
  const expected = Buffer.from(cookieToken);
  const received = Buffer.from(headerToken);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function requestAccessToken(request: Request, config: ReporterTokenConfig): string | null {
  const authorization = headerValue(request.headers.authorization);
  const cookieHeader = headerValue(request.headers.cookie);
  if (authorization && cookieHeader) throw new AppError('FORBIDDEN', { status: 403 });

  if (authorization) {
    if (headerValue(request.headers.origin)) throw new AppError('FORBIDDEN', { status: 403 });
    const bearer = authorization.match(/^Bearer ([A-Za-z0-9_.-]+)$/i)?.[1];
    if (!bearer) throw new AppError('UNAUTHENTICATED', { status: 401 });
    return bearer;
  }

  if (!cookieHeader) return null;
  const values = cookies(cookieHeader);
  const origin = headerValue(request.headers.origin);
  const safeMethod = ['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  if (safeMethod && origin && !config.webOrigins.has(origin)) throw new AppError('FORBIDDEN', { status: 403 });
  if (!safeMethod && !validDoubleSubmitCsrf(request, config, values)) {
    throw new AppError('CSRF_INVALID', { status: 403 });
  }
  return values.get('c48_access') ?? null;
}

export function reporterAccessClaims(request: Request, config: ReporterTokenConfig): ReporterAccessTokenClaims | null {
  const token = requestAccessToken(request, config);
  return token ? verifyReporterAccessToken(token, config) : null;
}

export function requiredReporterAccessClaims(request: Request, config: ReporterTokenConfig): ReporterAccessTokenClaims {
  const claims = reporterAccessClaims(request, config);
  if (!claims) throw new AppError('UNAUTHENTICATED', { status: 401 });
  return claims;
}

export function reporterUserId(request: Request, config: ReporterTokenConfig): string | null {
  return reporterAccessClaims(request, config)?.sub ?? null;
}
