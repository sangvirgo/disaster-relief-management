import { generateKeyPairSync } from 'node:crypto';
import { AppError } from '@c48/technical/errors/errors';
import { CampaignScopeService } from '../src/grants/campaign-scope.service';
import { CircuitBreakerClient } from '@c48/technical/http/service-client';

describe('CampaignScopeService', () => {
  it('requires the campaign response to include an active status', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const service = new CampaignScopeService({
      issuer: 'identity', privateKey, publicKey,
      clients: { identity: { id: 'identity', secret: 'a'.repeat(32), audiences: ['response', 'logistics'] } },
    });
    (service as unknown as { client: CircuitBreakerClient }).client = {
      get: async () => ({ status: 200, body: { id: 'campaign-id', status: 'ACTIVE' } }),
      close: () => undefined,
    } as unknown as CircuitBreakerClient;

    await expect(service.assertActiveCampaign('campaign-id')).resolves.toBeUndefined();
  });

  it('maps malformed Response data to the unavailable dependency error', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const service = new CampaignScopeService({
      issuer: 'identity', privateKey, publicKey,
      clients: { identity: { id: 'identity', secret: 'a'.repeat(32), audiences: ['response', 'logistics'] } },
    });
    (service as unknown as { client: CircuitBreakerClient }).client = {
      get: async () => ({ status: 200, body: { id: 'campaign-id' } }),
      close: () => undefined,
    } as unknown as CircuitBreakerClient;

    await expect(service.assertActiveCampaign('campaign-id'))
      .rejects.toMatchObject({ code: 'RESPONSE_UNAVAILABLE', status: 503 } satisfies Partial<AppError>);
  });
});
