import { describe, expect, it, jest } from '@jest/globals';
import { Registry } from 'prom-client';
import {
  callOllamaJson, geminiSchemaToJsonSchema, getOllamaFallbackConfig, hedgeWithFallback, OllamaCallError,
} from '../src/ai/ollama-json-client';
import { registerGeminiMetrics } from '../src/observability/gemini-metrics';

const config = { baseUrl: 'http://ollama:11434', model: 'qwen3.5:0.8b-q8_0', timeoutMs: 5000, hedgeMs: 0, numCtx: 4096 };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Ollama fallback configuration', () => {
  it('is disabled unless both the URL and the model are set', () => {
    expect(getOllamaFallbackConfig({})).toBeNull();
    expect(getOllamaFallbackConfig({ OLLAMA_BASE_URL: 'http://ollama:11434' })).toBeNull();
    expect(getOllamaFallbackConfig({ OLLAMA_MODEL: 'm' })).toBeNull();
    expect(getOllamaFallbackConfig({ OLLAMA_BASE_URL: 'http://ollama:11434/', OLLAMA_MODEL: ' m ' }))
      .toEqual({ baseUrl: 'http://ollama:11434', model: 'm', timeoutMs: 90_000, hedgeMs: 3_000, numCtx: 4096 });
  });

  it('keeps out-of-range numbers at their defaults and accepts a zero hedge delay', () => {
    const value = getOllamaFallbackConfig({
      OLLAMA_BASE_URL: 'http://o', OLLAMA_MODEL: 'm', OLLAMA_TIMEOUT_MS: '10', AI_FALLBACK_HEDGE_MS: '0', OLLAMA_NUM_CTX: 'abc',
    });
    expect(value).toMatchObject({ timeoutMs: 90_000, hedgeMs: 0, numCtx: 4096 });
  });
});

describe('geminiSchemaToJsonSchema', () => {
  it('lowercases types and turns nullable fields into JSON Schema unions', () => {
    expect(geminiSchemaToJsonSchema({
      type: 'OBJECT',
      properties: {
        priority: { type: 'STRING', nullable: true, enum: ['P1', 'P2'] },
        tags: { type: 'ARRAY', items: { type: 'STRING' } },
      },
      required: ['priority'],
    })).toEqual({
      type: 'object',
      properties: {
        priority: { type: ['string', 'null'], enum: ['P1', 'P2', null] },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['priority'],
    });
  });
});

describe('callOllamaJson', () => {
  it('sends a structured, non-thinking chat request and parses the JSON content', async () => {
    const fetchImpl = jest.fn(async () => new Response(JSON.stringify({ message: { content: '{"a":1}' } }), { status: 200 }));
    const value = await callOllamaJson({
      config, prompt: 'Dữ kiện', responseSchema: { type: 'OBJECT' }, maxOutputTokens: 512, fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(value).toEqual({ a: 1 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://ollama:11434/api/chat');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: config.model, stream: false, think: false, format: { type: 'object' } });
    expect(body.options).toEqual({ temperature: 0, num_ctx: 4096, num_predict: 512 });
  });

  it('reports invalid output, HTTP and network failures without the prompt', async () => {
    const registry = new Registry();
    registerGeminiMetrics(registry);
    const call = (reply: () => Promise<Response>) => callOllamaJson({
      config, prompt: 'bí mật của người báo', responseSchema: {}, maxOutputTokens: 10, fetchImpl: reply as unknown as typeof fetch,
    });
    await expect(call(async () => new Response(JSON.stringify({ message: { content: 'không phải JSON' } })))).rejects.toMatchObject({ kind: 'INVALID_OUTPUT' });
    await expect(call(async () => new Response('{}', { status: 500 }))).rejects.toMatchObject({ kind: 'HTTP', status: 500 });
    await expect(call(async () => { throw new TypeError('fetch failed'); })).rejects.toBeInstanceOf(OllamaCallError);
    const metrics = await registry.metrics();
    expect(metrics).toContain('c48_ai_fallback_attempts_total{model="qwen3.5:0.8b-q8_0",outcome="invalid_output"} 1');
    expect(metrics).toContain('outcome="network"} 1');
    expect(metrics).not.toContain('bí mật');
  });
});

describe('hedgeWithFallback', () => {
  it('keeps the primary result and aborts a fallback that already started', async () => {
    let fallbackSignal: AbortSignal | undefined;
    const result = await hedgeWithFallback(async () => { await wait(20); return 'gemini'; }, async (signal) => {
      fallbackSignal = signal;
      await wait(200);
      return 'ollama';
    }, 0);
    expect(result).toEqual({ value: 'gemini', source: 'PRIMARY' });
    expect(fallbackSignal?.aborted).toBe(true);
  });

  it('does not start the fallback when the primary answers before the hedge delay', async () => {
    const fallback = jest.fn(async () => 'ollama');
    await expect(hedgeWithFallback(async () => 'gemini', fallback, 1000)).resolves.toEqual({ value: 'gemini', source: 'PRIMARY' });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('uses the fallback as soon as the primary fails, before the hedge delay', async () => {
    const started = Date.now();
    const result = await hedgeWithFallback(async () => { throw new Error('AI_PROVIDER_ERROR:429'); }, async () => 'ollama', 10_000);
    expect(result).toEqual({ value: 'ollama', source: 'FALLBACK' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('rethrows the primary error when both fail, and the primary error alone without a fallback', async () => {
    const primary = async () => { throw new Error('AI_PROVIDER_ERROR:429'); };
    await expect(hedgeWithFallback(primary, async () => { throw new Error('OLLAMA_TIMEOUT'); }, 0)).rejects.toThrow('AI_PROVIDER_ERROR:429');
    await expect(hedgeWithFallback(primary, null, 0)).rejects.toThrow('AI_PROVIDER_ERROR:429');
  });
});

describe('AI provider duration metrics', () => {
  it('records the fallback call duration by model and outcome', async () => {
    const registry = new Registry();
    registerGeminiMetrics(registry);
    await callOllamaJson({
      config, prompt: 'p', responseSchema: {}, maxOutputTokens: 10,
      fetchImpl: (async () => new Response(JSON.stringify({ message: { content: '{}' } }))) as unknown as typeof fetch,
    });
    expect(await registry.metrics()).toMatch(/c48_ai_fallback_duration_seconds_count\{model="qwen3\.5:0\.8b-q8_0",outcome="ok"\} 1/u);
  });
});
