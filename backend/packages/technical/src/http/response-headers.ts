import type { Response } from 'express';
import { AppError } from '../errors/errors';

/** Marks a response as non-cacheable (private or mutable data). */
export function noStore(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
}

/** Returns the idempotency key attached by `IdempotencyKeyInterceptor`, or rejects the request. */
export function requireIdempotencyKey(request: { idempotencyKey?: string }): string {
  if (!request.idempotencyKey) throw new AppError('IDEMPOTENCY_KEY_INVALID', { status: 400 });
  return request.idempotencyKey;
}

/** Flags a response that was served from a stored idempotent result. */
export function markIdempotentReplay(response: Response, isReplay: boolean): void {
  if (isReplay) response.setHeader('Idempotent-Replay', 'true');
}
