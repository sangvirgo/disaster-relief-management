import { Counter, Gauge, Histogram, type Registry } from 'prom-client';

/** What one attempt against one API key ended with. A fixed set, so the label stays bounded. */
export type GeminiOutcome = 'ok' | 'quota_429' | 'auth_401_403' | 'timeout_408' | 'server_5xx' | 'timeout' | 'network' | 'http_other' | 'invalid_output';

/** What one call to the local fallback model (Ollama) ended with. */
export type AiFallbackOutcome = 'cancelled' | 'ok' | 'timeout' | 'network' | 'http_other' | 'invalid_output';

/** Which model produced a saved SOS advisory (`none` for a failure or a scheduled retry). */
export type AiAdvisorySource = 'gemini_primary' | 'gemini_backup' | 'ollama' | 'none';
export type AiAdvisoryOutcome = 'completed' | 'retry_scheduled' | 'failed';

let attempts: Counter<'model' | 'key_slot' | 'outcome'> | undefined;
let geminiDuration: Histogram<'model' | 'outcome'> | undefined;
let fallbackAttempts: Counter<'model' | 'outcome'> | undefined;
let fallbackDuration: Histogram<'model' | 'outcome'> | undefined;
let advisoryResults: Counter<'source' | 'outcome'> | undefined;
let geminiCooldown: Gauge<'model'> | undefined;
let fallbackConfigured: Gauge | undefined;
let fallbackConfiguredValue = 0;

/** Registers the AI provider metrics on a service registry. Called by installMetrics. Labels never carry keys or text. */
export function registerGeminiMetrics(registry: Registry): void {
  attempts = new Counter({
    name: 'c48_gemini_attempts_total',
    help: 'Gemini generateContent attempts by model, API key slot (1-based position in the configured list, never the key) and outcome.',
    labelNames: ['model', 'key_slot', 'outcome'] as const,
    registers: [registry],
  });
  geminiDuration = new Histogram({
    name: 'c48_gemini_attempt_duration_seconds',
    help: 'Duration of one Gemini generateContent attempt by model and outcome.',
    labelNames: ['model', 'outcome'] as const,
    buckets: [0.5, 1, 2, 4, 8, 15, 25, 35],
    registers: [registry],
  });
  fallbackAttempts = new Counter({
    name: 'c48_ai_fallback_attempts_total',
    help: 'Calls to the local fallback model (Ollama) by model and outcome. A call aborted because Gemini answered first is counted as `cancelled`.',
    labelNames: ['model', 'outcome'] as const,
    registers: [registry],
  });
  fallbackDuration = new Histogram({
    name: 'c48_ai_fallback_duration_seconds',
    help: 'Duration of one call to the local fallback model (Ollama) by model and outcome.',
    labelNames: ['model', 'outcome'] as const,
    buckets: [5, 10, 20, 30, 45, 60, 90, 120],
    registers: [registry],
  });
  advisoryResults = new Counter({
    name: 'c48_ai_advisory_results_total',
    help: 'Settled SOS advisory attempts by the model family that answered (gemini_primary, gemini_backup, ollama, none) and outcome.',
    labelNames: ['source', 'outcome'] as const,
    registers: [registry],
  });
  geminiCooldown = new Gauge({
    name: 'c48_gemini_model_cooldown',
    help: '1 while a Gemini model is paused after a 429 (15 min) or 503 (1 min); the next model or the fallback serves meanwhile.',
    labelNames: ['model'] as const,
    registers: [registry],
  });
  fallbackConfigured = new Gauge({
    name: 'c48_ai_fallback_configured',
    help: '1 when response-api has OLLAMA_BASE_URL and OLLAMA_MODEL set.',
    registers: [registry],
  });
  fallbackConfigured.set(fallbackConfiguredValue);
}

export function geminiOutcomeForStatus(status: number): GeminiOutcome {
  if (status === 429) return 'quota_429';
  if (status === 401 || status === 403) return 'auth_401_403';
  if (status === 408) return 'timeout_408';
  if (status >= 500) return 'server_5xx';
  return 'http_other';
}

// Every recorder below does nothing when metrics are not installed (tests, scripts) and never throws:
// metrics must never break a provider call.

/** Records one attempt, and its duration in seconds when given. */
export function recordGeminiAttempt(model: string, keyIndex: number, outcome: GeminiOutcome, seconds?: number): void {
  try {
    attempts?.inc({ model: model.slice(0, 60), key_slot: String(keyIndex + 1), outcome });
    if (seconds !== undefined) geminiDuration?.observe({ model: model.slice(0, 60), outcome }, seconds);
  } catch { /* ignore */ }
}

/** Records one fallback call, and its duration in seconds when given. */
export function recordAiFallbackAttempt(model: string, outcome: AiFallbackOutcome, seconds?: number): void {
  try {
    fallbackAttempts?.inc({ model: model.slice(0, 60), outcome });
    if (seconds !== undefined) fallbackDuration?.observe({ model: model.slice(0, 60), outcome }, seconds);
  } catch { /* ignore */ }
}

export function recordAiAdvisoryResult(source: AiAdvisorySource, outcome: AiAdvisoryOutcome): void {
  try { advisoryResults?.inc({ source, outcome }); } catch { /* ignore */ }
}

export function setGeminiCooldown(model: string, active: boolean): void {
  try { geminiCooldown?.set({ model: model.slice(0, 60) }, active ? 1 : 0); } catch { /* ignore */ }
}

export function setAiFallbackConfigured(configured: boolean): void {
  fallbackConfiguredValue = configured ? 1 : 0;
  try { fallbackConfigured?.set(fallbackConfiguredValue); } catch { /* ignore */ }
}
