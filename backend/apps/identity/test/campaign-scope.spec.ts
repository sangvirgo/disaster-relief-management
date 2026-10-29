import { generateKeyPairSync } from 'node:crypto';
import { AppError } from '@c48/technical/errors/errors';
import { CampaignScopeService } from '../src/grants/campaign-scope.service';
import { CircuitBreakerClient } from '@c48/technical/http/service-client';

describe('CampaignScopeService', () => {
  it('maps malformed Response data to the unavailable dependency error', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const service = new CampaignScopeService({
      issuer: 'identity', privateKey, publicKey,
      clients: { identity: { id: 'identity', secret: 'a'.repeat(32), audiences: ['response', 'logistics'] } },
    });
    (service as unknown as { client: CircuitBreakerClient }).client = {
      get: async () => ({ status: 200, body: null }),
      close: () => undefined,
    } as unknown as CircuitBreakerClient;

    await expect(service.assertActiveCampaign('campaign-id', 'organization-id'))
      .rejects.toMatchObject({ code: 'RESPONSE_UNAVAILABLE', status: 503 } satisfies Partial<AppError>);
  });
});
