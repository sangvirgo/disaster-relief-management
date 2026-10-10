import { generateKeyPairSync } from 'node:crypto';
import { issueServiceToken, loadServiceTokenConfig, ServiceTokenConfig, verifyServiceToken } from '../src/auth/service-tokens';

const pair = generateKeyPairSync('rsa', { modulusLength: 3072, publicExponent: 0x10001 });
const config = {
  issuer: 'https://c48.test',
  privateKey: pair.privateKey,
  publicKey: pair.publicKey,
  clients: {
    response: { id: 'c48-response', secret: 'response-secret-at-least-32-characters', audiences: ['identity', 'logistics'] },
    logistics: { id: 'c48-logistics', secret: 'logistics-secret-at-least-32-characters', audiences: ['identity', 'response'] },
  },
} satisfies ServiceTokenConfig;

describe('Identity service tokens', () => {
  it('issues a five-minute token restricted to the requested audience and caller', () => {
    const now = 1_800_000_000_000;
    const token = issueServiceToken(config, 'response', config.clients.response!.secret, 'identity', now);

    expect(verifyServiceToken(token, config, 'identity', ['response'], now)).toMatchObject({
      iss: config.issuer,
      aud: 'identity',
      sub: 'response',
      iat: now / 1_000,
      exp: now / 1_000 + 300,
    });
  });

  it('rejects invalid client credentials, audiences, callers, and expired tokens', () => {
    const now = 1_800_000_000_000;
    expect(() => issueServiceToken(config, 'response', 'wrong-secret', 'identity', now)).toThrow();
    const token = issueServiceToken(config, 'response', config.clients.response!.secret, 'identity', now);
    expect(() => verifyServiceToken(token, config, 'logistics', ['response'], now)).toThrow();
    expect(() => verifyServiceToken(token, config, 'identity', ['logistics'], now)).toThrow();
    expect(() => verifyServiceToken(token, config, 'identity', ['response'], now + 300_000)).toThrow();
  });

  it('loads three distinct environment credentials and restricts audiences to other services', () => {
    const loaded = loadServiceTokenConfig(config, {
      NODE_ENV: 'development',
      IDENTITY_SERVICE_CLIENT_ID: 'identity-client',
      IDENTITY_SERVICE_CLIENT_SECRET: 'identity-secret-at-least-32-characters',
      RESPONSE_SERVICE_CLIENT_ID: 'response-client',
      RESPONSE_SERVICE_CLIENT_SECRET: 'response-secret-at-least-32-characters',
      LOGISTICS_SERVICE_CLIENT_ID: 'logistics-client',
      LOGISTICS_SERVICE_CLIENT_SECRET: 'logistics-secret-at-least-32-characters',
    });

    expect(loaded.clients.identity).toMatchObject({ id: 'identity-client', audiences: ['response', 'logistics'] });
    expect(loaded.clients.response).toMatchObject({ id: 'response-client', audiences: ['identity', 'logistics'] });
    expect(loaded.clients.logistics).toMatchObject({ id: 'logistics-client', audiences: ['identity', 'response'] });
  });
});
