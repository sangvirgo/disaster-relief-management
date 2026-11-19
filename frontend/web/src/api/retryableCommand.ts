import { api, ApiError, newCommandKey, type HttpMethod, type Service } from './client';

/*
 * Retry-safe command transport for commands that are not sent through CommandForm.
 * Every attempt gets an Idempotency-Key. A retry with the same scope and the same body reuses the key,
 * so the server replays the stored result. The key is dropped after success or a definitive refusal;
 * network loss and 5xx keep it so the same command can be retried safely.
 */

const pendingKeys = new Map<string, { fingerprint: string; key: string }>();

export async function sendRetryableCommand<T>(
  scope: string,
  service: Service,
  path: string,
  body: unknown,
  method: HttpMethod = 'POST',
): Promise<T> {
  const fingerprint = JSON.stringify(body);
  const previous = pendingKeys.get(scope);
  const key = previous && previous.fingerprint === fingerprint ? previous.key : newCommandKey();
  pendingKeys.set(scope, { fingerprint, key });
  try {
    const result = await api<T>(service, path, { method, body, idempotencyKey: key });
    pendingKeys.delete(scope);
    return result;
  } catch (error) {
    const retryable = error instanceof ApiError && (error.status === 0 || error.status >= 500);
    if (!retryable) pendingKeys.delete(scope);
    throw error;
  }
}

/** Drops a pending key, for example after the user changed the form so the next attempt is a new command. */
export function forgetCommandKey(scope: string): void {
  pendingKeys.delete(scope);
}
