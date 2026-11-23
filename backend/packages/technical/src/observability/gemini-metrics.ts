import { Counter, type Registry } from 'prom-client';

/** What one attempt against one API key ended with. A fixed set, so the label stays bounded. */
export type GeminiOutcome = 'ok' | 'quota_429' | 'auth_401_403' | 'timeout_408' | 'server_5xx' | 'timeout' | 'network' | 'http_other' | 'invalid_output';

let attempts: Counter<'model' | 'key_slot' | 'outcome'> | undefined;

/** Registers the Gemini attempt counter on a service registry. Called by installMetrics. */
export function registerGeminiMetrics(registry: Registry): void {
  attempts = new Counter({
    name: 'c48_gemini_attempts_total',
    help: 'Gemini generateContent attempts by model, API key slot (1-based position in the configured list, never the key) and outcome.',
    labelNames: ['model', 'key_slot', 'outcome'] as const,
    registers: [registry],
  });
}

export function geminiOutcomeForStatus(status: number): GeminiOutcome {
  if (status === 429) return 'quota_429';
  if (status === 401 || status === 403) return 'auth_401_403';
  if (status === 408) return 'timeout_408';
  if (status >= 500) return 'server_5xx';
  return 'http_other';
}

/** Records one attempt. Does nothing when metrics are not installed (tests, scripts). Never throws. */
export function recordGeminiAttempt(model: string, keyIndex: number, outcome: GeminiOutcome): void {
  try {
    attempts?.inc({ model: model.slice(0, 60), key_slot: String(keyIndex + 1), outcome });
  } catch { /* metrics must never break a provider call */ }
}
