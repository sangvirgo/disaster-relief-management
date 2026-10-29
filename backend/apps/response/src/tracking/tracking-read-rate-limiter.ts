import { createHash } from 'node:crypto';
import { AppError } from '@c48/technical/errors/errors';

const trackingMinuteMs = 60_000;
const trackingHourMs = 60 * trackingMinuteMs;

export class TrackingReadRateLimiter {
  private readonly attempts = new Map<string, number[]>();
  private lastPrunedAt = Number.NEGATIVE_INFINITY;

  assertAllowed(clientIp: string): void {
    const now = Date.now();
    const key = createHash('sha256').update(clientIp).digest('hex');
    const recent = (this.attempts.get(key) ?? []).filter((timestamp) => timestamp > now - trackingHourMs);
    const minute = recent.filter((timestamp) => timestamp > now - trackingMinuteMs);
    let retryAfterMs = 0;

    if (recent.length >= 60) retryAfterMs = Math.max(retryAfterMs, recent[0]! + trackingHourMs - now);
    if (minute.length >= 10) retryAfterMs = Math.max(retryAfterMs, minute[0]! + trackingMinuteMs - now);
    if (retryAfterMs > 0) {
      this.attempts.set(key, recent);
      throw new AppError('RATE_LIMITED', { status: 429, retryAfterSeconds: Math.ceil(retryAfterMs / 1_000) });
    }

    if (!this.attempts.has(key) && this.attempts.size >= 20_000 && now - this.lastPrunedAt >= trackingMinuteMs) {
      this.lastPrunedAt = now;
      this.prune(now);
    }
    if (!this.attempts.has(key) && this.attempts.size >= 20_000) {
      throw new AppError('RATE_LIMITED', { status: 429, retryAfterSeconds: 60 * 60 });
    }
    this.attempts.set(key, [...recent, now]);
  }

  private prune(now: number): void {
    for (const [key, timestamps] of this.attempts) {
      const recent = timestamps.filter((timestamp) => timestamp > now - trackingHourMs);
      if (recent.length) this.attempts.set(key, recent);
      else this.attempts.delete(key);
      if (this.attempts.size < 20_000) return;
    }
  }
}
