import { describe, expect, it, jest } from '@jest/globals';
import { callGeminiJson, GeminiCallError } from '@c48/technical/ai/gemini-json-client';
import { LogisticsResponseSupplyCandidatesClient } from '../src/integrations/response/response-supply-candidates.client';

const requestId = '11111111-1111-4111-8111-111111111111';

function validRow(overrides: Record<string, unknown> = {}) {
  return {
    request_id: requestId, work_cycle: 1, campaign_id: null, status: 'VERIFIED', people_affected: 4,
    children_count: 0, elderly_count: 0, relief_items_text: 'nước uống', verified_at: '2026-11-18T10:00:00.000Z',
    ...overrides,
  };
}

function clientReturning(body: unknown, status = 200) {
  const get = jest.fn(async (_path: string, _options: unknown) => ({ status, headers: {}, body }));
  const client = new LogisticsResponseSupplyCandidatesClient(
    { get } as never,
    { serviceToken: jest.fn(async () => 'service-token') } as never,
  );
  return { client, get };
}

describe('LogisticsResponseSupplyCandidatesClient', () => {
  it('calls the internal scan with the service token, a limit and the cursor, and never a write verb', async () => {
    const { client, get } = clientReturning({ items: [], more: false });
    await client.list('abc', 50);
    expect(get).toHaveBeenCalledWith(
      '/api/v1/response/internal/requests/supply-candidates?limit=50&cursor=abc',
      { headers: { authorization: 'Bearer service-token' } },
    );
  });

  it('accepts a valid projection', async () => {
    const { client } = clientReturning({ items: [validRow()], more: true, cursor: 'next' });
    await expect(client.list(null, 50)).resolves.toEqual({
      items: [expect.objectContaining({ request_id: requestId, work_cycle: 1, relief_items_text: 'nước uống' })],
      more: true,
      cursor: 'next',
    });
  });

  it('treats a malformed row as Response being unavailable', async () => {
    const { client } = clientReturning({ items: [validRow({ status: 'SUBMITTED' })], more: false });
    await expect(client.list(null, 50)).rejects.toMatchObject({ code: 'RESPONSE_UNAVAILABLE' });
  });

  it('rejects a relief text longer than 500 characters', async () => {
    const { client } = clientReturning({ items: [validRow({ relief_items_text: 'a'.repeat(501) })], more: false });
    await expect(client.list(null, 50)).rejects.toMatchObject({ code: 'RESPONSE_UNAVAILABLE' });
  });

  it('rejects a non-200 response', async () => {
    const { client } = clientReturning({ code: 'UNAUTHENTICATED' }, 401);
    await expect(client.list(null, 50)).rejects.toMatchObject({ code: 'RESPONSE_UNAVAILABLE' });
  });
});

describe('callGeminiJson', () => {
  const schema = { type: 'OBJECT' };
  const base = {
    model: 'm', prompt: 'p', responseSchema: schema, timeoutMs: 1000, maxOutputTokens: 10,
  };
  const okBody = (text: string) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) });

  it('reports DISABLED without any network call when there is no key', async () => {
    const fetchImpl = jest.fn();
    await expect(callGeminiJson({ ...base, apiKeys: [], deadlineMs: Date.now() + 5000, fetchImpl: fetchImpl as never }))
      .rejects.toMatchObject({ kind: 'DISABLED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('parses JSON output and sends the schema in JSON mode', async () => {
    const fetchImpl = jest.fn(async (_url: string, _init: RequestInit) => okBody('{"item_ids":[]}'));
    const value = await callGeminiJson({ ...base, apiKeys: ['k'], deadlineMs: Date.now() + 5000, fetchImpl: fetchImpl as never });
    expect(value).toEqual({ item_ids: [] });
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body)).generationConfig).toMatchObject({ responseMimeType: 'application/json', responseSchema: schema, temperature: 0 });
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
  });

  it('moves to the next key on a quota response and reports QUOTA when every key is exhausted', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 429 }));
    await expect(callGeminiJson({ ...base, apiKeys: ['a', 'b'], deadlineMs: Date.now() + 5000, fetchImpl: fetchImpl as never }))
      .rejects.toMatchObject({ kind: 'QUOTA', status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports TIMEOUT when the attempt is aborted', async () => {
    const fetchImpl = jest.fn(async () => { throw Object.assign(new Error('aborted'), { name: 'TimeoutError' }); });
    await expect(callGeminiJson({ ...base, apiKeys: ['a'], deadlineMs: Date.now() + 5000, fetchImpl: fetchImpl as never }))
      .rejects.toMatchObject({ kind: 'TIMEOUT' });
  });

  it('reports INVALID_OUTPUT when the model text is not JSON', async () => {
    const fetchImpl = jest.fn(async () => okBody('not json'));
    await expect(callGeminiJson({ ...base, apiKeys: ['a'], deadlineMs: Date.now() + 5000, fetchImpl: fetchImpl as never }))
      .rejects.toBeInstanceOf(GeminiCallError);
  });

  it('stops without a network call once the deadline has passed', async () => {
    const fetchImpl = jest.fn();
    await expect(callGeminiJson({ ...base, apiKeys: ['a'], deadlineMs: Date.now() - 1, fetchImpl: fetchImpl as never }))
      .rejects.toMatchObject({ kind: 'TIMEOUT' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
