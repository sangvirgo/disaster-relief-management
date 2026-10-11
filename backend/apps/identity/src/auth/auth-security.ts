import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  KeyObject,
  randomBytes,
  randomUUID,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import { availableParallelism } from 'node:os';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import { PepperSet } from '../../../../packages/technical/src/security/secret-hash';

export interface IdentityAuthConfig {
  issuer: string;
  audience: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  csrfKey: Buffer;
  refreshPeppers: PepperSet;
  currentRefreshPepperVersion: string;
  webOrigins: ReadonlySet<string>;
  argonMemoryKib: number;
  argonTimeCost: number;
  argonParallelism: number;
  argonMaxConcurrency: number;
}

export interface AccessTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  sid: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface AccessTokenInput {
  userId: string;
  familyId: string;
  absoluteExpiresAt: Date;
  now?: number;
}

let generatedTestPair: { privateKey: KeyObject; publicKey: KeyObject } | undefined;
let generatedTestPepper: string | undefined;

function testPair(): { privateKey: KeyObject; publicKey: KeyObject } {
  if (!generatedTestPair) {
    const pair = generateKeyPairSync('rsa', { modulusLength: 3072, publicExponent: 0x10001 });
    generatedTestPair = { privateKey: pair.privateKey, publicKey: pair.publicKey };
  }
  return generatedTestPair;
}

function positiveInteger(value: string | undefined, name: string, fallback: number, min: number, max: number, errors: string[]): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    errors.push(name);
    return fallback;
  }
  return parsed;
}

function loadRsaKeys(env: Record<string, string | undefined>, errors: string[]): { privateKey: KeyObject; publicKey: KeyObject } {
  const privateEncoded = env.JWT_PRIVATE_KEY;
  if ((!privateEncoded || privateEncoded.startsWith('base64-encoded-')) && env.NODE_ENV === 'test') return testPair();
  try {
    if (!privateEncoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(privateEncoded)) throw new Error('invalid');
    const privateKey = createPrivateKey(Buffer.from(privateEncoded, 'base64'));
    if (privateKey.asymmetricKeyType !== 'rsa' || Number(privateKey.asymmetricKeyDetails?.modulusLength) < 3072) throw new Error('invalid');
    const publicKey = createPublicKey(privateKey);
    if (env.JWT_PUBLIC_KEY && !env.JWT_PUBLIC_KEY.startsWith('base64-encoded-')) {
      const configuredPublic = createPublicKey(Buffer.from(env.JWT_PUBLIC_KEY, 'base64'));
      const expected = publicKey.export({ type: 'spki', format: 'der' });
      const actual = configuredPublic.export({ type: 'spki', format: 'der' });
      if (configuredPublic.asymmetricKeyType !== 'rsa' || !Buffer.from(expected).equals(Buffer.from(actual))) throw new Error('invalid');
    }
    return { privateKey, publicKey };
  } catch {
    errors.push('JWT_PRIVATE_KEY');
    return testPair();
  }
}

function parseOrigins(value: string | undefined, nodeEnv: string, errors: string[]): Set<string> {
  const configured = value === undefined || value === ''
    ? nodeEnv === 'test' ? ['http://localhost'] : nodeEnv === 'development' ? ['http://localhost:8080'] : []
    : value.split(',').map((origin) => origin.trim());
  const origins = new Set<string>();
  for (const origin of configured) {
    try {
      const url = new URL(origin);
      if (url.origin !== origin || !['https:', ...(nodeEnv === 'development' || nodeEnv === 'test' ? ['http:'] : [])].includes(url.protocol) || url.username || url.password) {
        errors.push('WEB_ALLOWED_ORIGINS');
      } else {
        origins.add(origin);
      }
    } catch {
      errors.push('WEB_ALLOWED_ORIGINS');
    }
  }
  if (origins.size === 0) errors.push('WEB_ALLOWED_ORIGINS');
  return origins;
}

export function loadIdentityAuthConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): IdentityAuthConfig {
  const errors: string[] = [];
  const nodeEnv = env.NODE_ENV ?? 'development';
  const issuer = env.JWT_ISSUER ?? (nodeEnv === 'test' ? 'https://c48.test' : '');
  const audience = env.JWT_AUDIENCE ?? (nodeEnv === 'test' ? 'c48-test' : '');
  if (!issuer || !audience || /\s/.test(issuer) || /\s/.test(audience)) errors.push('JWT_ISSUER', 'JWT_AUDIENCE');
  const keys = loadRsaKeys(env, errors);
  const csrfKey = createHash('sha256').update('c48.identity.csrf.v1\0').update(keys.privateKey.export({ type: 'pkcs8', format: 'der' })).digest();
  const refreshPeppers: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    const match = name.match(/^SECRET_HASH_PEPPER_AUTH_(V[1-9][0-9]*)$/);
    if (match && value && value.length >= 32) refreshPeppers[match[1]!.toLowerCase()] = value;
    else if (match && value) errors.push(name);
  }
  if (!Object.keys(refreshPeppers).length && nodeEnv === 'test') {
    generatedTestPepper ??= randomBytes(32).toString('hex');
    refreshPeppers.v1 = generatedTestPepper;
  }
  const currentRefreshPepperVersion = (env.SECRET_HASH_PEPPER_AUTH_CURRENT ?? 'v1').toLowerCase();
  if (!/^v[1-9][0-9]*$/.test(currentRefreshPepperVersion) || !refreshPeppers[currentRefreshPepperVersion]) {
    errors.push('SECRET_HASH_PEPPER_AUTH_CURRENT');
  }
  const webOrigins = parseOrigins(env.WEB_ALLOWED_ORIGINS, nodeEnv, errors);
  const argonMemoryKib = positiveInteger(env.ARGON2_MEMORY_KIB, 'ARGON2_MEMORY_KIB', 65_536, 8_192, 262_144, errors);
  const argonTimeCost = positiveInteger(env.ARGON2_TIME_COST, 'ARGON2_TIME_COST', 3, 1, 10, errors);
  const argonParallelism = positiveInteger(env.ARGON2_PARALLELISM, 'ARGON2_PARALLELISM', 1, 1, 8, errors);
  const argonMaxConcurrency = positiveInteger(env.ARGON2_MAX_CONCURRENCY, 'ARGON2_MAX_CONCURRENCY', Math.max(1, Math.floor(availableParallelism() / 2)), 1, 128, errors);
  if (errors.length) throw new Error(`Invalid Identity auth configuration: ${[...new Set(errors)].join(', ')}`);
  return {
    issuer,
    audience,
    ...keys,
    csrfKey,
    refreshPeppers,
    currentRefreshPepperVersion,
    webOrigins,
    argonMemoryKib,
    argonTimeCost,
    argonParallelism,
    argonMaxConcurrency,
  };
}

export function issueAccessToken(config: IdentityAuthConfig, input: AccessTokenInput): string {
  const issuedAt = Math.floor((input.now ?? Date.now()) / 1_000);
  const expiresAt = Math.min(issuedAt + 600, Math.floor(input.absoluteExpiresAt.getTime() / 1_000));
  if (expiresAt <= issuedAt) throw new AppError('SESSION_EXPIRED', { status: 401 });
  const claims: AccessTokenClaims = {
    iss: config.issuer,
    aud: config.audience,
    sub: input.userId,
    sid: input.familyId,
    iat: issuedAt,
    exp: expiresAt,
    jti: randomUUID(),
  };
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), config.privateKey).toString('base64url')}`;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sessionExpired(): AppError {
  return new AppError('SESSION_EXPIRED', { status: 401 });
}

export function verifyAccessToken(token: string, config: IdentityAuthConfig, now = Date.now()): AccessTokenClaims {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw sessionExpired();
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as { alg?: unknown; typ?: unknown };
    const claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<AccessTokenClaims>;
    const signed = `${encodedHeader}.${encodedPayload}`;
    if (header.alg !== 'RS256' || header.typ !== 'JWT' ||
        !verify('RSA-SHA256', Buffer.from(signed), config.publicKey, Buffer.from(encodedSignature, 'base64url')) ||
        claims.iss !== config.issuer || claims.aud !== config.audience ||
        typeof claims.sub !== 'string' || !uuidPattern.test(claims.sub) ||
        typeof claims.sid !== 'string' || !uuidPattern.test(claims.sid) ||
        typeof claims.iat !== 'number' || !Number.isSafeInteger(claims.iat) ||
        typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp) ||
        claims.exp <= Math.floor(now / 1_000) || claims.iat > Math.floor(now / 1_000) + 30 ||
        claims.exp <= claims.iat || claims.exp > claims.iat + 600 ||
        typeof claims.jti !== 'string' || !uuidPattern.test(claims.jti)) throw sessionExpired();
    return claims as AccessTokenClaims;
  } catch {
    throw sessionExpired();
  }
}

export function createCsrfToken(config: IdentityAuthConfig, preSessionId: string): string {
  return createHmac('sha256', config.csrfKey).update('csrf\0').update(preSessionId).digest('base64url');
}

export function verifyCsrfToken(config: IdentityAuthConfig, preSessionId: string, token: string): boolean {
  if (!preSessionId || !token) return false;
  const expected = Buffer.from(createCsrfToken(config, preSessionId));
  const actual = Buffer.from(token);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    if (name && !cookies.has(name)) cookies.set(name, part.slice(separator + 1).trim());
  }
  return cookies;
}

const commonPasswords = new Set([
  'password123', 'password1', '1234567890', 'qwerty1234', 'qwertyuiop', 'letmein123', 'iloveyou', 'welcome123',
  'admin12345', 'abc1234567', '1111111111', '0000000000', 'changeme123', 'monkey12345', 'dragon12345', 'football1',
  'sunshine123', 'princess123', 'trustno123', 'password!', 'passw0rd123', 'p@ssword123',
]);

export function assertStrongPassword(password: string, username: string): void {
  const normalized = password.toLowerCase();
  if ([...password].length < 10 || [...password].length > 256 || normalized === username.toLowerCase() || commonPasswords.has(normalized)) {
    throw new AppError('PASSWORD_WEAK', { status: 400 });
  }
}

interface WindowEntry {
  count: number;
  expiresAt: number;
}

export class WindowRateLimiter {
  private readonly entries = new Map<string, WindowEntry>();

  constructor(private readonly now: () => number = Date.now, private readonly maxEntries = 20_000) {}

  consume(key: string, limit: number, windowMs: number): number {
    if (!key || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
      throw new RangeError('Invalid rate limit');
    }
    const now = this.now();
    const id = createHash('sha256').update(key).digest('hex');
    let entry = this.entries.get(id);
    if (entry && entry.expiresAt <= now) {
      this.entries.delete(id);
      entry = undefined;
    }
    if (!entry) {
      this.prune(now);
      if (this.entries.size >= this.maxEntries) return Math.max(1, Math.ceil(windowMs / 1_000));
      entry = { count: 0, expiresAt: now + windowMs };
      this.entries.set(id, entry);
    }
    if (entry.count >= limit) return Math.max(1, Math.ceil((entry.expiresAt - now) / 1_000));
    entry.count++;
    return 0;
  }

  private prune(now: number): void {
    if (this.entries.size < this.maxEntries) return;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
      if (this.entries.size < this.maxEntries) break;
    }
  }
}
