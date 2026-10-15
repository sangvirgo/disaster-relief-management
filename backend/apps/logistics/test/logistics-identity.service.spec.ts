import { AppError } from '../../../packages/technical/src/errors/errors';
import { jest } from '@jest/globals';
import { LogisticsIdentityService, LogisticsIdentityConfig } from '../src/auth/logistics-identity.service';

const config: LogisticsIdentityConfig = {
  identityBaseUrl: 'http://identity.test',
  clientId: 'c48-logistics-test',
  clientSecret: 'c48-test-logistics-secret-not-for-deployment-0001',
  timeoutMs: 500,
};

describe('Logistics Identity region lookup', () => {
  it('caches service tokens independently by audience', async () => {
    const post = jest.fn(async (_path: string, body: { audience: string }) => ({
      status: 200,
      body: { access_token: `${body.audience}-token`, expires_in: 300 },
    }));
    const identity = new LogisticsIdentityService({ post } as never, config);

    await expect(identity.serviceToken('identity')).resolves.toBe('identity-token');
    await expect(identity.serviceToken('response')).resolves.toBe('response-token');
    await expect(identity.serviceToken('response')).resolves.toBe('response-token');

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls.map(([, body]) => body.audience)).toEqual(['identity', 'response']);
  });

  it('requires an active exact region and forwards the verified user transport', async () => {
    const client = { get: jest.fn().mockResolvedValue({
      status: 200,
      body: { items: [{ code: 'R01', status: 'ACTIVE', name: 'Khu vực 1' }], next_cursor: null },
    }) };
    const identity = new LogisticsIdentityService(client as never, config);
    const headers = { cookie: 'c48_access=verified-token' };

    await expect(identity.assertActiveRegion('R01', headers)).resolves.toBeUndefined();
    expect(client.get).toHaveBeenCalledWith('/api/v1/identity/regions?limit=100', { headers });
  });

  it('rejects an inactive region using the existing validation error', async () => {
    const client = { get: jest.fn().mockResolvedValue({
      status: 200,
      body: { items: [{ code: 'R01', status: 'INACTIVE', name: 'Khu vực 1' }], next_cursor: null },
    }) };
    const identity = new LogisticsIdentityService(client as never, config);

    await expect(identity.assertActiveRegion('R01', { authorization: 'Bearer verified-token' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
  });

  it('turns Identity transport failures into the existing Vietnamese API error code', async () => {
    const client = { get: jest.fn().mockRejectedValue(new Error('network details')) };
    const identity = new LogisticsIdentityService(client as never, config);

    await expect(identity.assertActiveRegion('R01', { authorization: 'Bearer verified-token' }))
      .rejects.toMatchObject({ code: 'IDENTITY_UNAVAILABLE', status: 503 });
  });
});
