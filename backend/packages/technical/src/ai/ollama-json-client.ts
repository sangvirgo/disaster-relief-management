// Local fallback provider: an Ollama server on the internal Compose network (profile `ai-fallback`). It is only used
// when Gemini fails or is slow, never as the primary model. Like the Gemini client it never logs the prompt or the
// raw response body. Ollama has no API key: it is reachable only inside `c48-internal`.

import { recordAiFallbackAttempt } from '../observability/gemini-metrics';

export interface OllamaFallbackConfig {
  baseUrl: string;
  model: string;
  /** Per call, in milliseconds. A small model on 2 vCPU needs tens of seconds. */
  timeoutMs: number;
  /** Delay before the fallback starts while Gemini is still running. 0 starts both at the same time. */
  hedgeMs: number;
  numCtx: number;
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

/** Returns the fallback configuration, or null when OLLAMA_BASE_URL or OLLAMA_MODEL is empty (fallback disabled). */
export function getOllamaFallbackConfig(env: Record<string, string | undefined> = process.env): OllamaFallbackConfig | null {
  const baseUrl = env.OLLAMA_BASE_URL?.trim().replace(/\/+$/u, '');
  const model = env.OLLAMA_MODEL?.trim();
  if (!baseUrl || !model) return null;
  return {
    baseUrl,
    model,
    timeoutMs: boundedInt(env.OLLAMA_TIMEOUT_MS, 90_000, 5_000, 300_000),
    hedgeMs: boundedInt(env.AI_FALLBACK_HEDGE_MS, 3_000, 0, 60_000),
    numCtx: boundedInt(env.OLLAMA_NUM_CTX, 4096, 1024, 16384),
  };
}

/** Converts the Gemini OpenAPI-style schema (OBJECT, STRING, nullable) to the JSON Schema that Ollama `format` takes. */
export function geminiSchemaToJsonSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  const source = schema as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'nullable') continue;
    if (key === 'type' && typeof value === 'string') result.type = value.toLowerCase();
    else if (key === 'properties' && value && typeof value === 'object') {
      result.properties = Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .map(([name, child]) => [name, geminiSchemaToJsonSchema(child)]));
    } else if (key === 'items') result.items = geminiSchemaToJsonSchema(value);
    else result[key] = value;
  }
  if (source.nullable === true) {
    if (typeof result.type === 'string') result.type = [result.type, 'null'];
    if (Array.isArray(result.enum)) result.enum = [...result.enum, null];
  }
  return result;
}

export class OllamaCallError extends Error {
  constructor(readonly kind: 'TIMEOUT' | 'NETWORK' | 'HTTP' | 'INVALID_OUTPUT', readonly status: number | null = null) {
    super(`OLLAMA_${kind}`);
    this.name = 'OllamaCallError';
  }
}

export interface OllamaJsonRequest {
  config: OllamaFallbackConfig;
  prompt: string;
  /** Gemini-style schema; converted here. */
  responseSchema: Record<string, unknown>;
  maxOutputTokens: number;
  signal?: AbortSignal | undefined;
  fetchImpl?: typeof fetch;
}

/** One structured-output chat call. Thinking is off: it only costs CPU time on a small model. */
export async function callOllamaJson(request: OllamaJsonRequest): Promise<unknown> {
  const { config } = request;
  const fetchImpl = request.fetchImpl ?? fetch;
  const timeout = AbortSignal.timeout(config.timeoutMs);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
  let response: Response;
  const startedAt = Date.now();
  const seconds = () => (Date.now() - startedAt) / 1000;
  try {
    response = await fetchImpl(`${config.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: request.prompt }],
        format: geminiSchemaToJsonSchema(request.responseSchema),
        stream: false,
        think: false,
        keep_alive: '10m',
        options: { temperature: 0, num_ctx: config.numCtx, num_predict: request.maxOutputTokens },
      }),
      signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    if (!request.signal?.aborted) recordAiFallbackAttempt(config.model, aborted ? 'timeout' : 'network', seconds());
    throw new OllamaCallError(aborted ? 'TIMEOUT' : 'NETWORK');
  }
  if (!response.ok) {
    recordAiFallbackAttempt(config.model, 'http_other', seconds());
    throw new OllamaCallError('HTTP', response.status);
  }
  try {
    const payload = await response.json() as { message?: { content?: string } };
    const parsed = JSON.parse(payload.message?.content ?? '') as unknown;
    recordAiFallbackAttempt(config.model, 'ok', seconds());
    return parsed;
  } catch {
    recordAiFallbackAttempt(config.model, 'invalid_output', seconds());
    throw new OllamaCallError('INVALID_OUTPUT');
  }
}

/**
 * Runs the primary and, after `hedgeMs` or as soon as the primary fails, the fallback. The primary result always wins
 * when it succeeds (the fallback is then aborted); the fallback result is used only when the primary fails. When both
 * fail, the primary error is rethrown so retry and cooldown decisions keep following Gemini.
 */
export async function hedgeWithFallback<T>(
  primary: () => Promise<T>,
  fallback: ((signal: AbortSignal) => Promise<T>) | null,
  hedgeMs: number,
): Promise<{ value: T; source: 'PRIMARY' | 'FALLBACK' }> {
  if (!fallback) return { value: await primary(), source: 'PRIMARY' };
  const controller = new AbortController();
  let started: Promise<T> | undefined;
  const start = (): Promise<T> => {
    if (!started) {
      started = fallback(controller.signal);
      started.catch(() => undefined); // observed below or abandoned after a primary success
    }
    return started;
  };
  const timer = hedgeMs > 0 ? setTimeout(start, hedgeMs) : undefined;
  if (hedgeMs <= 0) start();
  try {
    const value = await primary();
    controller.abort();
    return { value, source: 'PRIMARY' };
  } catch (primaryError) {
    try {
      return { value: await start(), source: 'FALLBACK' };
    } catch {
      throw primaryError;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}
