import { api, ApiError, newCommandKey } from '../../api/client';

/*
 * Network layer for pickup tickets. Every command gets an Idempotency-Key. A retry with the same
 * scope and the same body reuses the key, so the server replays the stored result instead of
 * running the step again. The key is dropped after success or a definitive refusal (4xx other than
 * network loss); a changed body (for example a new expected_version) gets a new key.
 */

const pendingKeys = new Map<string, { fingerprint: string; key: string }>();

export const readPickup = <T>(path: string) => api<T>('logistics', path);

export async function sendPickupCommand<T>(
  scope: string,
  path: string,
  body: unknown,
  method: 'POST' | 'PUT' = 'POST',
): Promise<T> {
  const fingerprint = JSON.stringify(body);
  const previous = pendingKeys.get(scope);
  const key = previous && previous.fingerprint === fingerprint ? previous.key : newCommandKey();
  pendingKeys.set(scope, { fingerprint, key });
  try {
    const result = await api<T>('logistics', path, { method, body, idempotencyKey: key });
    pendingKeys.delete(scope);
    return result;
  } catch (error) {
    const retryable = error instanceof ApiError && (error.status === 0 || error.status >= 500);
    if (!retryable) pendingKeys.delete(scope);
    throw error;
  }
}
