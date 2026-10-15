import { createHmac, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppError } from '../../../../packages/technical/src/errors/errors';

const windowMs = 15 * 60_000;
const maxAttempts = 5;
const maxPhones = 10_000;
const key = randomBytes(32);

@Injectable()
export class DonationPhoneThrottle {
  // shortcut: phone quota is process-local; move to a shared keyed quota before adding Logistics replicas.
  private readonly attempts = new Map<string, { startedAt: number; count: number }>();

  assertAllowed(phone: string, now = Date.now()): void {
    const phoneKey = createHmac('sha256', key).update(phone).digest('hex');
    const current = this.attempts.get(phoneKey);

    if (!current || now - current.startedAt >= windowMs) {
      if (!current && this.attempts.size >= maxPhones) this.attempts.delete(this.attempts.keys().next().value!);
      this.attempts.set(phoneKey, { startedAt: now, count: 1 });
      return;
    }

    if (current.count >= maxAttempts) {
      throw new AppError('RATE_LIMITED', {
        status: 429,
        retryAfterSeconds: Math.ceil((windowMs - (now - current.startedAt)) / 1000),
      });
    }

    current.count++;
    this.attempts.delete(phoneKey);
    this.attempts.set(phoneKey, current);
  }
}
