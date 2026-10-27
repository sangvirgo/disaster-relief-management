import { jest } from '@jest/globals';
import { ServiceTokenCache } from '../src/http/service-token-cache';

describe('service token transport cache', () => {
  afterEach(() => jest.restoreAllMocks());
  it('refreshes before expiry, coalesces refreshes and keeps audiences separate', async () => {
    let now = 1000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const post = jest.fn(async (_path: string, body: { audience: string }) => ({ status: 200, body: { access_token: `${body.audience}-${now}`, expires_in: 300 } }));
    const cache = new ServiceTokenCache({ post } as never, { clientId: 'test', clientSecret: 'test' });
    expect(await Promise.all([cache.get('response'), cache.get('response')])).toEqual(['response-1000', 'response-1000']);
    await cache.get('logistics');
    expect(post).toHaveBeenCalledTimes(2);
    now = 270999;
    expect(await cache.get('response')).toBe('response-1000');
    now = 271000;
    expect(await Promise.all([cache.get('response'), cache.get('response')])).toEqual(['response-271000', 'response-271000']);
    expect(post).toHaveBeenCalledTimes(3);
  });
  it.each([
    { status: 503, body: null },
    { status: 200, body: { access_token: 'token', expires_in: 0 } },
    { status: 200, body: { access_token: 'token', expires_in: 1.5 } },
    { status: 200, body: { expires_in: 300 } },
  ])('does not cache failed or malformed token responses: %j', async (result) => {
    const post = jest.fn(async () => result);
    const cache = new ServiceTokenCache({ post } as never, { clientId: 'test', clientSecret: 'test' });
    await expect(cache.get()).rejects.toMatchObject({ code: 'IDENTITY_UNAVAILABLE', status: 503 });
    await expect(cache.get()).rejects.toMatchObject({ code: 'IDENTITY_UNAVAILABLE', status: 503 });
    expect(post).toHaveBeenCalledTimes(2);
  });
});
