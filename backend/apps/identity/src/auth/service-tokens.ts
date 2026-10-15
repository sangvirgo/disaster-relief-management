import { KeyObject, randomUUID, sign, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../../../packages/technical/src/errors/errors';
import type { ServiceName, ServiceTokenClaims } from '../../../../packages/technical/src/security/service-token';

export { verifyServiceToken } from '../../../../packages/technical/src/security/service-token';
export type { ServiceName, ServiceTokenClaims } from '../../../../packages/technical/src/security/service-token';

export const IDENTITY_SERVICE_TOKEN_CONFIG = Symbol('IDENTITY_SERVICE_TOKEN_CONFIG');

export interface ServiceClient {
  id: string;
  secret: string;
  audiences: readonly ServiceName[];
}

export interface ServiceTokenConfig {
  issuer: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  clients: Partial<Record<ServiceName, ServiceClient>>;
}

const clientAudiences: Record<ServiceName, readonly ServiceName[]> = {
  identity: ['response', 'logistics'],
  response: ['identity', 'logistics'],
  logistics: ['identity', 'response'],
};

const services: readonly ServiceName[] = ['identity', 'response', 'logistics'];

function unauthorized(): AppError {
  return new AppError('UNAUTHENTICATED', { status: 401 });
}

function secretMatches(expected: string, received: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

export function loadServiceTokenConfig(
  auth: Pick<ServiceTokenConfig, 'issuer' | 'privateKey' | 'publicKey'>,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): ServiceTokenConfig {
  const clients = {} as Record<ServiceName, ServiceClient>;
  const errors: string[] = [];
  for (const service of services) {
    const prefix = `${service.toUpperCase()}_SERVICE_CLIENT`;
    const idName = `${prefix}_ID`;
    const secretName = `${prefix}_SECRET`;
    const id = env[idName] ?? (env.NODE_ENV === 'test' ? `c48-${service}-test` : '');
    const secret = env[secretName] ?? (env.NODE_ENV === 'test' ? `c48-test-${service}-secret-not-for-deployment-0001` : '');
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(id)) errors.push(idName);
    if (secret.length < 32) errors.push(secretName);
    clients[service] = { id, secret, audiences: clientAudiences[service] };
  }
  if (new Set(services.map((service) => clients[service].id)).size !== services.length) errors.push('SERVICE_CLIENT_ID');
  if (errors.length) throw new Error(`Invalid Identity service-token configuration: ${[...new Set(errors)].join(', ')}`);
  return { ...auth, clients };
}

export function issueServiceToken(
  config: ServiceTokenConfig,
  caller: ServiceName,
  clientSecret: string,
  audience: ServiceName,
  now = Date.now(),
): string {
  const client = config.clients[caller];
  if (!client || !secretMatches(client.secret, clientSecret)) throw unauthorized();
  if (audience === caller || !client.audiences.includes(audience)) throw new AppError('FORBIDDEN', { status: 403 });

  const issuedAt = Math.floor(now / 1_000);
  const claims: ServiceTokenClaims = {
    iss: config.issuer,
    aud: audience,
    sub: caller,
    iat: issuedAt,
    exp: issuedAt + 300,
    jti: randomUUID(),
  };
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign('RSA-SHA256', Buffer.from(unsigned), config.privateKey).toString('base64url')}`;
}
