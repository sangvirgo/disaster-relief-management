import { describe, expect, it } from '@jest/globals';
import { Registry } from 'prom-client';
import { callGeminiJson } from '../src/ai/gemini-json-client';
import { geminiOutcomeForStatus, recordGeminiAttempt, registerGeminiMetrics } from '../src/observability/gemini-metrics';

const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }), { status: 200 });

describe('Gemini metrics', () => {
  it('maps statuses to a bounded outcome set', () => {
    expect([429, 401, 403, 408, 503, 400].map(geminiOutcomeForStatus)).toEqual(['quota_429', 'auth_401_403', 'auth_401_403', 'timeout_408', 'server_5xx', 'http_other']);
  });

  it('counts each attempt by model and key slot, never by the key itself', async () => {
    const registry = new Registry();
    registerGeminiMetrics(registry);
    const replies = [new Response('{}', { status: 429 }), ok()];
    const secret = 'AIza-secret-key-value';
    await callGeminiJson({
      model: 'gemini-test', apiKeys: [secret, 'second-secret'], prompt: 'p', responseSchema: {}, timeoutMs: 1000, deadlineMs: Date.now() + 5000,
      maxOutputTokens: 10, fetchImpl: (async () => replies.shift()!) as typeof fetch,
    });
    const body = await registry.metrics();
    expect(body).toContain('c48_gemini_attempts_total{model="gemini-test",key_slot="1",outcome="quota_429"} 1');
    expect(body).toContain('c48_gemini_attempts_total{model="gemini-test",key_slot="2",outcome="ok"} 1');
    expect(body).not.toContain(secret);
    expect(body).not.toContain('second-secret');
  });

  it('is a no-op before metrics are installed', () => {
    expect(() => recordGeminiAttempt('m', 0, 'ok')).not.toThrow();
  });
});
