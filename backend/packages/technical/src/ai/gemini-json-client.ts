// Minimal Gemini generateContent client for structured JSON output. Used by services that do not share the Response
// advisory queue (Logistics need extraction). It never logs or returns the API key, the prompt or the raw response body.
// Response keeps its own queue-based client; this module does not change that behaviour.

export type GeminiJsonSchema = Record<string, unknown>;

export interface GeminiJsonRequest {
  model: string;
  apiKeys: readonly string[];
  prompt: string;
  responseSchema: GeminiJsonSchema;
  /** Per attempt, in milliseconds. The whole call is also bounded by deadlineMs. */
  timeoutMs: number;
  deadlineMs: number;
  maxOutputTokens: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export type GeminiFailureKind = 'DISABLED' | 'QUOTA' | 'TIMEOUT' | 'NETWORK' | 'HTTP' | 'INVALID_OUTPUT';

export class GeminiCallError extends Error {
  constructor(readonly kind: GeminiFailureKind, readonly status: number | null = null) {
    super(`GEMINI_${kind}`);
    this.name = 'GeminiCallError';
  }
}

const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Calls generateContent in JSON mode. Keys are tried in order; a quota (429), forbidden/unauthorized key (401/403) or
 * a transient provider error (408, 5xx) moves to the next key. Any other failure stops the call. Returns the parsed
 * JSON object produced by the model; the caller still validates it.
 */
export async function callGeminiJson(request: GeminiJsonRequest): Promise<unknown> {
  if (request.apiKeys.length === 0) throw new GeminiCallError('DISABLED');
  const fetchImpl = request.fetchImpl ?? fetch;
  const now = request.now ?? Date.now;
  const url = `${endpoint}/${encodeURIComponent(request.model)}:generateContent`;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: request.responseSchema,
      temperature: 0,
      maxOutputTokens: request.maxOutputTokens,
    },
  });
  let last: GeminiCallError = new GeminiCallError('HTTP', 503);
  for (const apiKey of request.apiKeys) {
    const remaining = request.deadlineMs - now();
    if (remaining <= 0) throw new GeminiCallError('TIMEOUT');
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body,
        signal: AbortSignal.timeout(Math.min(request.timeoutMs, remaining)),
      });
    } catch (error) {
      last = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        ? new GeminiCallError('TIMEOUT')
        : new GeminiCallError('NETWORK');
      continue;
    }
    if (!response.ok) {
      const status = response.status;
      if (status === 429) last = new GeminiCallError('QUOTA', status);
      else if (status === 401 || status === 403 || status === 408 || status >= 500) last = new GeminiCallError('HTTP', status);
      else throw new GeminiCallError('HTTP', status);
      continue;
    }
    let parsed: unknown;
    try {
      const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      parsed = JSON.parse(payload.candidates?.[0]?.content?.parts?.[0]?.text ?? '') as unknown;
    } catch {
      throw new GeminiCallError('INVALID_OUTPUT');
    }
    return parsed;
  }
  throw last;
}
